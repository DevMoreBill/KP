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
      discount: true, amountInWords: true, currencyNote: true, footer: true,
      signImage: false, stampImage: false   // подпись и печать картинками под контактами (картинки — в «Подпись и печать»)
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
      signWidthCm: 3.5, stampWidthCm: 4, // ширина картинок подписи и печати
      stampX: 4, stampY: -2.2,    // печать: от левого края текста и от строки подписи, см
      keyParamMaxChars: 28,       // значения длиннее в плитки не берутся
      componentPhotoWidthCm: 4.6, componentPhotoHeightCm: 3.2,
      kitKeyParams: 3,            // характеристик элемента в таблице «Состав изделия» (полностью — в карточке элемента)
      kitPhotoWidthCm: 3.6, kitPhotoHeightCm: 2.8,
      clientsWidthCm: 0,          // ширина картинки «Наши клиенты», 0 — во всю ширину текста
      coverCardsMax: 8,           // моделей карточками с фото на титуле; больше — сводкой по видам оборудования
      compactCards: true,         // небольшие позиции — карточками по нескольку на странице (а не страница на каждую)
      compactFrom: 3,             // карточки — когда в КП столько страниц оборудования и больше
      compactMaxRows: 14,         // позиция «небольшая»: строк характеристик не больше…
      compactMaxChars: 1000,      // …и описания не длиннее (знаков), без узлов с фото и сборок
      hyphenation: true           // автоматические переносы слов в описаниях (заголовки, названия, числа — без переносов)
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
      specCont: '{name} (продолжение)', coverMore: ' и ещё {n}', coverOther: 'Прочее оборудование',
      galleryTitle: 'Фото и схемы',
      offerTitle: 'Коммерческое предложение',
      colNo: '№', colName: 'Наименование', colQty: 'Кол-во', colPrice: 'Цена за ед., {cur}', colSum: 'Сумма, {cur}',
      colDisc: 'Скидка', subtotal: 'Сумма без скидки', discountTotal: 'Скидка', coverDiscount: 'с учётом скидки {sum} {cur}',
      pcs: 'шт.', included: 'включено', total: 'Итого', vatIncl: 'в т. ч. НДС {vat} %', grandTotal: 'Итого к оплате с НДС',
      inWordsLabel: 'Итого: ', inWords: '{words}, в т. ч. НДС {vat} % — {vatSum} {cur}',
      currencyNote: 'Цены указаны в {curName}. Оплата производится в рублях по курсу ЦБ РФ на дату оплаты.',
      currencyRate: ' Справочно: курс ЦБ РФ{rateDate} — 1 {cur} = {rate} руб.; сумма в рублях — {rub} руб.',
      conditionsTitle: 'Условия предложения', condExtraTitle: 'Дополнительные условия', contactsTitle: 'Контактная информация',
      signLine: 'Подпись:', closing1: 'С уважением и надеждой', closing2: 'на плодотворное сотрудничество',
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
      aboutBrand: { size: 9.5, color: 'DARK', bold: true },
      cardTitle: { size: 12, color: 'BLUE', bold: true },
      coverGroup: { size: 8.5, color: 'DARK', bold: true },
      coverList: { size: 8.5, color: 'DARK' }
    },
    about: '',
    advantages: [],
    trust: '',
    clientsTitle: 'Наши клиенты',
    closing: ''
  };

  // ---------------------------------------------------------------- текущие настройки
  let TPL = DEFAULTS, T = DEFAULTS.texts, RULES = DEFAULTS.rules, BLK = DEFAULTS.blocks;
  let BLUE, SKY, NAVYD, DARK, GRAY, LIGHT, LINE, HAIR, FRAME;
  const BASEW = 10347;       // ширина текста, под которую нарисованы пропорции (А4, поля 1,25 / 1,5 см)
  let W = BASEW;             // фактическая ширина текста — из полей страницы base.docx
  let PAGEH = 14100;         // высота текста страницы (твипы) с запасом на шапку — для раскладки титула
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
    FRAME = [4, HAIR];
    W = BASEW; PAGEH = 14100;
    const sect = TPL.sect || '';
    const num = re => { const m = re.exec(sect); return m ? +m[1] : 0; };
    const pw = num(/<w:pgSz[^>]*w:w="(\d+)"/), ml = num(/<w:pgMar[^>]*w:left="(\d+)"/), mr = num(/<w:pgMar[^>]*w:right="(\d+)"/);
    if (pw && ml && mr) W = pw - ml - mr;
    // высота текста: лист без верхнего и нижнего полей и с запасом на шапку страницы (она бывает выше поля)
    const ph = num(/<w:pgSz[^>]*w:h="(\d+)"/), mt = num(/<w:pgMar[^>]*w:top="(\d+)"/), mb = num(/<w:pgMar[^>]*w:bottom="(\d+)"/);
    if (ph && mt && mb) PAGEH = ph - mt - mb - 420;
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

  // ---------------------------------------------------------------- типографика и оценка высоты текста
  // Неразрывные пробелы там, где перенос строки выглядит небрежно: число и единица измерения («22 кВт»), разряды
  // («1 500»), «№ 5», короткие предлоги и союзы со следующим словом, тире не в начале строки, «т. ч.», «г. Москва»,
  // инициалы. Списки в описаниях («• …», «- …», «1) …») — отдельными абзацами с висячим отступом.
  class Typo {
    static text(s) {
      s = String(s == null ? '' : s);
      if (s.indexOf(' ') < 0) return s;
      return s
        .replace(/(\d) (?=\d{3}(?!\d))/g, '$1 ')
        .replace(/(\d) (?=(?:%|‰|°[CС]?|[A-Za-zА-Яа-яЁёµΩ³²°/]{1,7}\.?)(?=[\s,.;:)(!?»"]|$))/g, '$1 ')
        .replace(/(№|§) (?=\S)/g, '$1 ')
        .replace(/ ([—–]) /g, ' $1 ')
        .replace(Typo.SHORT, '$1 ')
        .replace(/(?<=^|[\s(«"„])т\. ([чедп])\./g, 'т. $1.')
        .replace(/(?<=^|[\s(«"„,])((?:г|ул|д|стр|корп|оф|пос|пгт|обл|пр|пер|пл|наб|ш|им|рис|табл|п|с)\.) (?=[\dА-ЯЁA-Z«"])/g, '$1 ')
        .replace(/(?<=^|\s)([А-ЯЁ]\.) (?=[А-ЯЁ])/g, '$1 ');
    }
    // название организации коротко: «Общество с ограниченной ответственностью «Ромашка»» → «ООО «Ромашка»»
    static org(s) {
      let x = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
      for (const [re, ab] of Typo.ORG) if (re.test(x)) { x = x.replace(re, ab + ' '); break; }
      return x;
    }
    // дефисы внутри кодов (слово с цифрами или с двумя заглавными подряд) → метка \u0002 (в r() — неразрывный дефис Word)
    static codes(s) {
      return s.indexOf('-') < 0 ? s : s.replace(/[^\s]+/g, tok => /\d|[A-ZА-ЯЁ]{2}/.test(tok) ? tok.replace(/(?<=[0-9A-Za-zА-Яа-яЁё.,/)])-(?=[0-9A-Za-zА-Яа-яЁё(])/g, '\u0002') : tok);
    }
    // номер модели, телефон — одной строкой: пробелы неразрывные, дефисы — неразрывные дефисы Word
    static solid(t, o) {
      const hy = r('-', o).replace(/<w:t xml:space="preserve">-<\/w:t>/, '<w:noBreakHyphen/>');
      return String(t == null ? '' : t).split('-').map(part => r(part.replace(/ /g, NB), o)).join(hy);
    }
    // текст со строками → абзацы; строки-пункты списка — с маркером и висячим отступом; o — как у p() (after — после всего)
    static paras(text, st, o = {}) {
      const L = String(text == null ? '' : text).split(/\r?\n/), out = [];
      let n = L.length, gap = 0;
      while (n && !L[n - 1].trim()) n--;
      for (let i = 0; i < n; i++) {
        const line = L[i].replace(/\s+$/, '');
        if (!line.trim()) { gap = 80; continue; }
        const m = Typo.ITEM.exec(line), last = i === n - 1;
        const po = Object.assign({}, o, { before: out.length ? gap : (o.before || 0), after: last ? (o.after || 0) : (m ? 20 : (o.gap == null ? 50 : o.gap)) });
        if (o.tail && i === n - 2) po.keep = true;      // последняя строка не уходит одна на следующую страницу
        gap = 0;
        if (m) {
          const ind = (o.indL || 0) + Typo.IND, mk = /\d/.test(m[1]) ? m[1] : '•';
          out.push(p(r(mk, st) + '<w:r><w:tab/></w:r>' + r(m[2], st), Object.assign(po, { indL: ind, hang: Typo.IND, tab: ind, jc: 'left' })));
        } else out.push(p(r(line.trim(), st), po));
      }
      return out.join('') || p(r('', st), o);
    }
  }
  Typo.SHORT = /(?<=^|[\s(«"„])(в|к|с|у|о|и|а|я|во|ко|со|об|от|до|из|за|на|по|не|ни|но|да|же|при|без|для|под|над|про)(?: )(?=[^\s—–])/giu;
  Typo.ITEM = /^\s*([•·▪◦‣*\-–—]|\d{1,2}[.)])\s+(.*)$/;
  Typo.IND = 220;
  Typo.ORG = [['Общество с ограниченной ответственностью', 'ООО'], ['Публичное акционерное общество', 'ПАО'], ['Непубличное акционерное общество', 'НАО'],
    ['Закрытое акционерное общество', 'ЗАО'], ['Открытое акционерное общество', 'ОАО'], ['Акционерное общество', 'АО'], ['Индивидуальный предприниматель', 'ИП'],
    ['Федеральное государственное унитарное предприятие', 'ФГУП'], ['Государственное унитарное предприятие', 'ГУП'], ['Муниципальное унитарное предприятие', 'МУП'],
    ['Федеральное государственное бюджетное учреждение', 'ФГБУ'], ['Государственное бюджетное учреждение', 'ГБУ'], ['Муниципальное бюджетное учреждение', 'МБУ'],
    ['Муниципальное казённое учреждение', 'МКУ'], ['Государственное казённое учреждение', 'ГКУ']].map(([f, a]) => [new RegExp('^' + f + '\\s+', 'i'), a]);

  // Word не сообщает высоту текста при сборке файла — она оценивается по средней ширине знака шрифта (с запасом):
  // так плашки фиксированной высоты не обрезают текст, а титул раскладывается на одну страницу
  class Fit {
    // строк текста в колонке шириной w (твипы) стилем st (имя стиля или sty(...))
    static lines(text, w, st) {
      const s = typeof st === 'string' ? sty(st) : st;
      const cw = s.sz / 2 * 20 * (s.caps ? 0.7 : s.b ? 0.6 : 0.55) + (s.sp || 0);
      const per = Math.max(4, Math.floor(w / cw * 0.92));
      return String(text == null ? '' : text).split(/\r?\n/).reduce((a, l) => a + Math.max(1, Math.ceil(l.length / per)), 0);
    }
    // высота абзаца (твипы): строки × межстрочный интервал (line — как в p(): 240 — одинарный) + отступы до и после
    static h(text, w, st, line, before, after) {
      const s = typeof st === 'string' ? sty(st) : st;
      return Math.ceil(Fit.lines(text, w, s) * s.sz / 2 * 20 * 1.16 * (line || 259) / 240) + (before || 0) + (after || 0);
    }
  }

  // ---------------------------------------------------------------- строительные блоки Word
  // o.solid — без типографской обработки (адреса, e-mail, ссылки)
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
    // перенос строки внутри короткого текста — разрыв строки (списки в описаниях — абзацами, см. Typo.paras);
    // дефис внутри кода модели («CAAD-0.7/B», «EAGLE-N») — неразрывный: код не рвётся на две строки
    const run = x => `<w:r><w:rPr>${rp}</w:rPr><w:t xml:space="preserve">${esc(x)}</w:t></w:r>`, nbh = `<w:r><w:rPr>${rp}</w:rPr><w:noBreakHyphen/></w:r>`;
    return String(t == null ? '' : t).split(/\r?\n/).map(line => Typo.codes(o.solid ? line : Typo.text(line)).split('\u0002').map(run).join(nbh)).join('<w:r><w:br/></w:r>');
  }
  // абзац: keep — не отрывать от следующего; lines — не разрывать абзац; pbb — с новой страницы; hy — можно переносить слова;
  // hang — висячий отступ (пункт списка), tab — позиция табуляции
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
    if (o.lines) pp += '<w:keepLines/>';
    if (o.pbb) pp += '<w:pageBreakBefore/>';
    pp += '<w:widowControl/>';
    if (o.bdr) pp += `<w:pBdr>${o.bdr}</w:pBdr>`;
    if (o.tab || o.rtab) pp += `<w:tabs>${o.tab ? `<w:tab w:val="left" w:pos="${o.tab}"/>` : ''}${o.rtab ? `<w:tab w:val="right" w:pos="${o.rtab}"/>` : ''}</w:tabs>`;
    if (!o.hy) pp += '<w:suppressAutoHyphens/>';
    const ls = o.line ? ` w:line="${o.line}" w:lineRule="auto"` : '';
    pp += `<w:spacing w:before="${o.before || 0}" w:after="${o.after || 0}"${ls}/>`;
    if (o.indL || o.indR || o.hang) pp += `<w:ind w:left="${o.indL || 0}" w:right="${o.indR || 0}"${o.hang ? ` w:hanging="${o.hang}"` : ''}/>`;
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
    const hs = o.heights || {}, mh = o.minH || {};
    const body = rows.map((row, i) => {
      let trp = '';
      if (hs[i]) trp += `<w:trHeight w:val="${hs[i]}" w:hRule="exact"/>`;
      else if (mh[i]) trp += `<w:trHeight w:val="${mh[i]}" w:hRule="atLeast"/>`;
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

  // заголовок раздела: крупный текст и короткая линия-акцент; длинное название позиции — мельче (не на полстраницы)
  const HEADMARK = '\u0001KPHEAD\u0001';   // место сразу после заголовка раздела (для картинок «в начале раздела»)
  function heading(title, pbb) {
    const n = String(title || '').length, k = n > 110 ? 0.72 : n > 70 ? 0.84 : 1;
    let st = 'heading';
    if (k < 1) { const s = sty('heading'); st = Object.assign(s, { sz: Math.round(s.sz * k), mk: TPL.design ? 'KPS_heading' : '' }); RUNSTY = 'heading'; }
    return p(r(title, st), { after: 90, keep: true, line: 240, pbb }) +
      p('', { after: 220, indR: W - X(1500), keep: true, bdr: line('bottom', 18, SKY) }) + HEADMARK;
  }
  const blockTitle = (t, o) => p(r(t, 'blockTitle'), Object.assign({ after: 120, keep: true }, o || {}));

  const curCode = S => (S && S.cur && S.cur.code) || 'RUB';
  const curSh = S => (CURS[curCode(S)] || CURS.RUB).sh;
  const cm = v => Math.round(+v * CM);

  // ================================================================ ТИТУЛЬНЫЙ ЛИСТ
  // Титул — всегда одна страница. Высота блоков оценивается заранее (Fit); не помещаются — по ступеням LEVELS
  // уменьшаются отступы и фото, затем убираются второстепенные блоки: «Нам доверяют», преимущества, описание
  // под заголовком, «О компании», ключевые параметры. Моделей больше coverCardsMax — вместо карточек с фото
  // сводка «вид оборудования — модели — количество».
  class Cover {
    constructor(S, M) {
      this.S = S; this.M = M; this.t = totals(S.items, S.vat); this.c = S.cover || {};
      this.ST = (S.stations || []).filter(x => x && x.model);
      this.multi = this.ST.length >= 2;
      this.tight = this.ST.length >= RULES.compactCoverFrom;
    }
    xml() {
      let res = null;
      // в графическом редакторе — все блоки на месте (их стили и положение настраиваются)
      for (const lv of TPL.design ? Cover.LEVELS.slice(0, 1) : Cover.LEVELS) { res = this.build(lv); if (res.h <= PAGEH) break; }
      return res.xml;
    }
    build(lv) {
      const out = [];
      let h = 0;
      const add = (xml, hh) => { out.push(xml); h += hh; };
      const gap = v => { const g = Math.max(120, Math.round(v * lv.gap)); add(spacer(g), g); };
      add(...this.meta());
      gap(this.tight ? 500 : 900);
      this.head(lv, add);
      if (this.multi) { gap(this.tight ? 300 : 500); this.models(lv, add); }
      this.kpis(lv, add, gap);
      this.box(add, gap);
      this.company(lv, add, gap);
      return { xml: out.join(''), h };
    }
    // получатель · объект · дата
    meta() {
      const S = this.S, ct = S.contact || {}, ob = S.object || {}, client = Typo.org(S.client);
      const subs = [S.clientInn ? txt('inn', { inn: S.clientInn }) : '', ct.name ? txt('attention', { contact: [ct.post, ct.name].filter(Boolean).join(' ') }) : ''].filter(Boolean);
      const subTx = subs.length ? subs.join('\n') : txt('supplyUnits', { units: this.t.units });
      const sub = subs.length ? subs.map(x => r(x, 'muted')).join('<w:r><w:br/></w:r>') : r(subTx, 'muted');
      const dsub = S.number ? '№ ' + S.number + (S.city ? ' · ' + S.city : '') : (S.city || '');
      const cell = (label, val, valTx, valSt, subX, subT, w, first, jc) => {
        const bd = line('top', 4, LINE) + (first ? '<w:left w:val="nil"/>' : line('left', 4, LINE)) + line('bottom', 4, LINE) + '<w:right w:val="nil"/>';
        const wi = w - (first ? 0 : 240);
        return [tc(p(r(label, 'metaLabel'), { after: 50, jc }) + p(val, { after: 30, line: 240, jc }) + p(subX, { line: 240, jc }), w, { bdr: bd, va: 'top', mar: [170, first ? 0 : 240, 170, 0] }),
          340 + Fit.h(label, wi, 'metaLabel', 259, 0, 50) + Fit.h(valTx || ' ', wi, valSt, 240, 0, 30) + Fit.h(subT || ' ', wi, 'muted', 240)];
      };
      const cn = sty('clientName'), date = ruDate(S.date);
      let cells, ws;
      if (ob.purpose || ob.address) {
        ws = cols([4100, 3647, 2600]);
        const cs = Object.assign({}, cn, { sz: cn.sz - 2 });
        cells = [cell(T.recipient, r(client, cs), client, cs, sub, subTx, ws[0], true, 'left'),
          cell(T.object, r(ob.purpose || ob.address, 'metaObject'), ob.purpose || ob.address, 'metaObject', r(ob.purpose ? (ob.address || '') : '', 'muted'), ob.purpose ? ob.address : '', ws[1], false, 'left'),
          cell(T.date, r(date, 'metaDate'), date, 'metaDate', r(dsub, 'muted'), dsub, ws[2], false, 'right')];
      } else {
        ws = cols([6847, 3500]);
        cells = [cell(T.recipient, r(client, cn), client, cn, sub, subTx, ws[0], true, 'left'), cell(T.date, r(date, 'metaDate'), date, 'metaDate', r(dsub, 'muted'), dsub, ws[1], false, 'right')];
      }
      return [tbl([cells.map(x => x[0])], ws), Math.max(...cells.map(x => x[1]))];
    }
    // надзаголовок, вид оборудования, модель, линия-акцент, описание; у одной модели справа — фото
    head(lv, add) {
      const c = this.c, M = this.M, photo = !this.multi && M.cover;
      const w2 = cols([6247, 4100]), wl = photo ? w2[0] : W, ms = this.multi ? 'coverModelMulti' : 'coverModel';
      let x = p(r(T.coverKicker, 'coverKicker'), { after: 160 }), h = Fit.h(T.coverKicker, wl, 'coverKicker', 259, 0, 160);
      if (c.title) { x += p(r(c.title, 'coverTitle'), { line: 240 }); h += Fit.h(c.title, wl, 'coverTitle', 240); }
      x += p(this.multi ? Cover.names(c.model || '', ms) : r(c.model || '', ms), { after: 120, line: 240 });
      h += Fit.h(c.model || ' ', wl, ms, 240, 0, 120);
      x += p('', { after: 200, indR: X(4700), bdr: line('bottom', 18, SKY) }); h += 480;
      if (c.desc && !lv.noDesc) { x += p(r(c.desc, 'coverDesc'), { line: 276, hy: true }); h += Fit.h(c.desc, wl, 'coverDesc', 276); }
      if (!photo) return add(x, h);
      // одна модель: фото вписывается в рамку с сохранением пропорций
      const BOXW = cm(RULES.coverPhotoWidthCm), BOXH = cm(RULES.coverPhotoHeightCm * lv.photo);
      const k = Math.min(BOXW / M.cover.w, BOXH / M.cover.h);
      const cxc = Math.round(M.cover.w * k), cyc = Math.round(M.cover.h * k);
      const fx = TPL.imgSize && TPL.imgSize.coverPhotoWidthCm, cyh = fx && +fx.w > 0 ? (+fx.h > 0 ? cm(fx.h) : Math.round(cm(fx.w) * cyc / cxc)) : cyc;
      add(tbl([[tc(x, w2[0], { va: 'center', mar: [0, 0, 0, 0] }), tc(p(img(M.cover.rid, cxc, cyc, 'Оборудование', 'coverPhotoWidthCm'), { jc: 'right' }), w2[1], { va: 'center', mar: [0, 0, 0, 0] })]], w2),
        Math.max(h, Math.round(cyh / E) + 60));
    }
    // модели в заголовке через « · »: короткое название — одной строкой, длинное переносится по пробелам
    static names(tx, st) {
      return String(tx).split(' · ').map(m => m.length <= 28 ? Typo.solid(m, sty(st)) : r(m, st)).join(r(' · ', st));
    }
    // несколько моделей: карточки с фото в один-два ряда; моделей больше coverCardsMax — сводка по видам оборудования
    models(lv, add) {
      add(blockTitle(T.coverModelsTitle), Fit.h(T.coverModelsTitle, W, 'blockTitle', 259, 0, 120));
      const ST = this.ST, n = ST.length;
      if (n > RULES.coverCardsMax) return this.summary(add);
      const rowsN = Math.ceil(n / Math.max(1, RULES.coverModelsPerRow)), per = Math.ceil(n / rowsN);
      const w = Math.floor(W / per), ws = Array.from({ length: per }, (_, i) => i === per - 1 ? W - w * (per - 1) : w);
      const BOXW = Math.min(3.8 * CM, (w - 300) * E), BOXH = (rowsN > 1 ? 2.0 : 2.6) * CM * lv.photo;
      const rows = [];
      let h = 0;
      for (let rI = 0; rI < rowsN; rI++) {
        const cells = [];
        let rh = 0;
        for (let cI = 0; cI < per; cI++) {
          const st = ST[rI * per + cI], bd = cI === 0 ? B() : B(null, [4, LINE]);
          if (!st) { cells.push(tc('', ws[cI], { bdr: bd })); continue; }
          const th = this.M.thumbs && this.M.thumbs[st.key], wi = ws[cI] - 240;
          let ph = '', ch = 120;
          if (th) { const k = Math.min(BOXW / th.w, BOXH / th.h), cy = Math.round(th.h * k); ph = p(img(th.rid, Math.round(th.w * k), cy, st.model), { jc: 'center', after: 100 }); ch += Math.round(cy / E) + 100; }
          const ex = [st.exec, st.qty ? st.qty + NB + T.pcs : ''].filter(Boolean).join(' · ');
          const body = ph + p(st.model.length <= 26 ? Typo.solid(st.model, 'stationModel') : r(st.model, 'stationModel'), { jc: 'center', after: 30, line: 240 }) +
            (st.power ? p(r(st.power, 'stationPower'), { jc: 'center', after: 20, line: 240 }) : '') + p(r(ex, 'muted'), { jc: 'center', line: 240 });
          ch += Fit.h(st.model, wi, 'stationModel', 240, 0, 30) + (st.power ? Fit.h(st.power, wi, 'stationPower', 240, 0, 20) : 0) + Fit.h(ex || ' ', wi, 'muted', 240);
          cells.push(tc(body, ws[cI], { bdr: bd, va: 'top', mar: [60, 120, 60, 120] }));
          rh = Math.max(rh, ch);
        }
        rows.push(cells); h += rh;
      }
      add(tbl(rows, ws), h);
    }
    // сводка: вид оборудования — модели (× количество) — всего штук
    summary(add) {
      const G = new Map();
      for (const st of this.ST) { const k = st.kind || T.coverOther; if (!G.has(k)) G.set(k, []); G.get(k).push(st); }
      let groups = [...G];
      if (groups.length > 10) groups = groups.slice(0, 9).concat([[T.coverOther, groups.slice(9).flatMap(g => g[1])]]);
      const wc = cols([3000, 6047, 1300]), MAXN = 8;
      let h = 0;
      const rows = groups.map(([kind, list], i) => {
        const names = list.slice(0, MAXN).map(st => st.model + (+st.qty > 1 ? NB + '×' + NB + st.qty : '')).join(' · ') + (list.length > MAXN ? txt('coverMore', { n: list.length - MAXN }) : '');
        const qty = list.reduce((a, st) => a + (+st.qty || 0), 0) + NB + T.pcs;
        const bd = B(i ? null : [4, LINE], null, [4, i === groups.length - 1 ? LINE : HAIR]);
        h += 190 + Math.max(Fit.h(kind, wc[0] - 120, 'coverGroup', 240), Fit.h(names, wc[1] - 240, 'coverList', 250));
        return [tc(p(r(kind, 'coverGroup'), { line: 240 }), wc[0], { bdr: bd, va: 'top', mar: [95, 0, 95, 120] }),
          tc(p(r(names, 'coverList'), { line: 250 }), wc[1], { bdr: bd, va: 'top', mar: [95, 120, 95, 120] }),
          tc(p(r(qty, 'coverGroup'), { jc: 'right', line: 240 }), wc[2], { bdr: bd, va: 'top', mar: [95, 120, 95, 0] })];
      });
      add(tbl(rows, wc), h);
    }
    // ключевые параметры (одна модель): крупные цифры в ряд
    kpis(lv, add, gap) {
      const kp = this.multi || !BLK.coverKpis || lv.noKpis ? [] : (this.c.kpis || []).filter(k => k.num);
      if (!kp.length) return;
      gap(900);
      add(blockTitle(T.kpisTitle), Fit.h(T.kpisTitle, W, 'blockTitle', 259, 0, 120));
      const n = kp.length, w = Math.floor(W / n), ws = kp.map((_, i) => i === n - 1 ? W - w * (n - 1) : w);
      let h = 0;
      const cells = kp.map((k, i) => {
        const wi = ws[i] - (i ? 340 : 120);
        h = Math.max(h, 120 + Fit.h(k.num + (k.unit ? ' ' + k.unit : ''), wi, 'kpiValue', 240, 0, 40) + Fit.h(k.cap || ' ', wi, 'muted', 240));
        return tc(p(r(k.num, 'kpiValue') + (k.unit ? r(' ' + k.unit, 'kpiUnit') : ''), { after: 40, line: 240 }) +
          p(r(k.cap || '', 'muted'), { line: 240 }), ws[i], { bdr: i === 0 ? B() : B(null, [4, LINE]), mar: [60, i === 0 ? 0 : 220, 60, 120] });
      });
      add(tbl([cells], ws), h);
    }
    // плашка «Состав поставки / Стоимость»: высота — по тексту («Включая: …» бывает в несколько строк)
    box(add, gap) {
      if (!BLK.coverTotal) return;
      const S = this.S, t = this.t, c = this.c, ST = this.ST;
      gap(this.tight ? 400 : 760);
      const one = S.items.length === 1;
      const comp = one ? `${S.items[0].qty} × ${c.model || S.items[0].name}` : this.multi ? `${ST.length} ${plural(ST.length, 'модель', 'модели', 'моделей')}, ${t.units} ед.` : `${S.items.length} ${plural(S.items.length, 'позиция', 'позиции', 'позиций')}, ${t.units} ед.`;
      const clean = s => String(s || '').replace(/\s+[—–-]\s+исполнение\s+\d+\s*$/i, '').trim();
      const optNames = [...new Set((BLK.coverKit ? S.items.flatMap(it => kitOf(it).map(kitName)) : []).concat(S.items.flatMap(it => (it.options || []).filter(o => o.name && +o.qty > 0).map(o => o.short || o.name))).map(clean))];
      const OM = RULES.coverOptionsMax;
      const inc = optNames.length && OM > 0 ? txt('including', { list: optNames.slice(0, OM).join(', ') }) + (optNames.length > OM ? T.includingMore : '') : '';
      const showD = BLK.discount && t.discount > 0, disc = showD ? txt('coverDiscount', { sum: money(t.discount), cur: curSh(S) }) : '';
      const w2 = cols([5847, 4500]), w1 = w2[0] - 420, wr = w2[1] - 420;
      const c1 = p(r(T.supplyTitle, 'boxLabel'), { after: 40 }) + p(r(comp, 'boxValue'), { after: inc ? 40 : 0, line: 240 }) + (inc ? p(r(inc, 'muted'), { line: 240 }) : '');
      const c2 = p(r(txt('priceWithVat', { vat: S.vat }), 'boxLabel'), { jc: 'right', after: 40 }) +
        p(r(money(t.sum), 'boxSum') + r(' ' + curSh(S), 'boxCurrency'), { jc: 'right' }) + (showD ? p(r(disc, 'muted'), { jc: 'right', before: 40, line: 240 }) : '');
      const h1 = Fit.h(T.supplyTitle, w1, 'boxLabel', 259, 0, 40) + Fit.h(comp, w1, 'boxValue', 240, 0, inc ? 40 : 0) + (inc ? Fit.h(inc, w1, 'muted', 240) : 0);
      const h2 = Fit.h(T.priceWithVat, wr, 'boxLabel', 259, 0, 40) + Fit.h(money(t.sum) + ' ' + curSh(S), wr, 'boxSum', 259) + (showD ? Fit.h(disc, wr, 'muted', 240, 40) : 0);
      const bh = Math.max(inc || showD ? 1500 : 1180, Math.round(Math.max(h1, h2) * 1.08) + 560);
      add(bgpara(W, bh, LIGHT, 160), 20);
      add(tbl([[tc(c1, w2[0], { mar: [0, 300, 0, 120] }), tc(c2, w2[1], { mar: [0, 120, 0, 300] })]], w2, { heights: { 0: bh } }), bh);
      if (BLK.coverDetailsNote && T.detailsNote) add(p(r(T.detailsNote, 'note'), { before: 100, hy: true }), Fit.h(T.detailsNote, W, 'note', 259, 100));
    }
    // о компании, преимущества, «нам доверяют»
    company(lv, add, gap) {
      const about = BLK.coverAbout && !lv.noAbout, AD = BLK.coverAdvantages && !lv.noAdv ? (TPL.advantages || []).slice(0, RULES.advantagesMax) : [];
      if (about || AD.length) gap(this.tight ? 500 : 900);
      if (about) {
        add(blockTitle(T.aboutTitle), Fit.h(T.aboutTitle, W, 'blockTitle', 259, 0, 120));
        const brand = (TPL.brandParts || []).map(x => x[0]).join('');
        add(p(brandRuns('aboutBrand') + r(TPL.about || '', 'about'), { after: 240, line: 276, jc: 'both', hy: true }), Fit.h(brand + (TPL.about || ''), W, 'about', 276, 0, 240));
      }
      if (AD.length) {
        const aw = Math.floor(W / AD.length), ws = AD.map((_, k) => k === AD.length - 1 ? W - aw * (AD.length - 1) : aw);
        let h = 0;
        const cells = AD.map(([ti, tx], k) => {
          h = Math.max(h, 40 + Fit.h(ti, ws[k] - 400, 'advTitle', 259, 0, 40) + Fit.h(tx, ws[k] - 400, 'advText', 250));
          return tc(p(r(ti, 'advTitle'), { after: 40 }) + p(r(tx, 'advText'), { line: 250, hy: true }), ws[k], { bdr: B(null, [18, SKY]), va: 'top', mar: [20, 160, 20, 240] });
        });
        add(tbl([cells], ws), h);
      }
      if (BLK.coverTrust && TPL.trust && !lv.noTrust) {
        gap(600);
        const tx = TPL.trust + (this.S.showClients && TPL.clients && sectionOn('clients') ? T.trustMore : '.');
        add(p(r(T.trustLabel, 'trustLabel') + r(tx, 'trustText'), { line: 250, hy: true }), Fit.h(T.trustLabel + tx, W, 'trustText', 250));
      }
    }
  }
  // ступени упрощения титула, если он не помещается на страницу (gap — доля отступов, photo — доля высоты фото)
  Cover.LEVELS = [
    { gap: 1, photo: 1 }, { gap: 0.6, photo: 1 }, { gap: 0.45, photo: 0.8 },
    { gap: 0.35, photo: 0.7, noTrust: true }, { gap: 0.35, photo: 0.7, noTrust: true, noAdv: true },
    { gap: 0.3, photo: 0.6, noTrust: true, noAdv: true, noDesc: true }, { gap: 0.3, photo: 0.6, noTrust: true, noAdv: true, noDesc: true, noAbout: true },
    { gap: 0.25, photo: 0.5, noTrust: true, noAdv: true, noDesc: true, noAbout: true, noKpis: true }
  ];
  const coverXml = (S, M) => new Cover(S, M).xml();

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
  // в одной колонке не влияет на соседнюю. Небольшие позиции, когда их много, — карточками (Card).
  // шапка таблицы — заливкой ячеек: повторяется на каждой странице длинной таблицы
  const HDR = (t, w, jc = 'left', span = 1) => tc(p(r(t, 'tableHeader'), { jc, keep: true, line: 240 }), w, { fill: NAVYD, mar: [80, 120, 80, 120], span });
  const PXCAP = 914400 / 150;   // EMU на пиксель при 150 dpi — мелкие картинки не растягиваются
  // «не отрывать»: все абзацы строк таблицы держатся со следующими — Word переносит такой блок целиком
  const keepAll = xml => xml.replace(/<w:pPr>(?!<w:keepNext\/>)/g, '<w:pPr><w:keepNext/>').replace(/<w:p>(?!<w:pPr>)/g, '<w:p><w:pPr><w:keepNext/></w:pPr>');
  const keepRow = row => row.map(keepAll);
  // строки таблицы: короткая (до 6 строк) — целиком; у длинной вместе первые две и последние три строки
  const keepTail = (i, n) => i < n - 1 && (n <= 6 || i === 0 || i >= n - 3);
  const specVal = row => row.hl ? 'specValueKey' : 'specValue';
  const fit = (g, bw, bh) => { const k = Math.min(bw / g.w, bh / g.h, PXCAP); return [Math.round(g.w * k), Math.round(g.h * k)]; };
  const NOM = [0, 0, 0, 0];   // рамка FRAME — тонкая линия цвета HAIR (задаётся в setTemplate: цвет — из настроек)
  const gapCell = w => tc(END, w, { mar: NOM });

  // подраздел страницы оборудования: заголовок и тонкая линия на всю ширину
  // aside — пояснение мелким шрифтом справа в той же строке (не занимает места и не отрывается от таблицы)
  function subheading(title, before, after, aside) {
    return p(r(title, 'subheading') + (aside ? '<w:r><w:tab/></w:r>' + r(aside, 'specNote') : ''), { before: before == null ? 320 : before, after: after == null ? 140 : after, keep: true, rtab: aside ? W : 0,
      bdr: `<w:bottom w:val="single" w:sz="6" w:space="4" w:color="${LINE}"/>` });
  }

  // ключевые параметры позиции: выделенные синим строки характеристик (или первые строки, если выделенных нет)
  function keyParams(it) {
    const rows = (it.groups || []).flatMap(g => (g.rows || []).filter(x => x.k && x.v));
    let list = rows.filter(x => x.hl);
    if (!list.length) list = rows.slice(0, 4);
    return list.filter(x => String(x.v).length <= RULES.keyParamMaxChars).slice(0, RULES.keyParamsMax);
  }
  // плитки ключевых параметров: значение крупно, подпись мелко; per — плиток в ряду
  function tilesXml(kp, wr, per) {
    const w = Math.floor(wr / per), ws = Array.from({ length: per }, (_, i) => i === per - 1 ? wr - w * (per - 1) : w), rows = [];
    for (let i = 0; i < kp.length; i += per) rows.push(ws.map((wj, j) => {
      const x = kp[i + j], last = i + per >= kp.length;
      if (!x) return tc(END, wj, { mar: NOM });
      return tc(p(r(x.v, 'heroValue'), { after: 30, line: 240 }) + p(r(x.k, 'heroLabel'), { line: 240 }), wj,
        { bdr: B(null, j ? [4, LINE] : null, last ? null : [4, LINE]), va: 'top', mar: [90, j ? 180 : 0, 110, 120] });
    }));
    return tbl(rows, ws);
  }
  // пункт «+ опция» с висячим отступом
  const optPara = (name, st, o) => p(r('+', st) + '<w:r><w:tab/></w:r>' + r(name, st), Object.assign({ after: 20, line: 250, indL: 200, hang: 200, tab: 200 }, o || {}));

  // первый экран: слева фото в светлой рамке, справа логотип, плитки ключевых параметров и коротко о главном.
  // Правая колонка не длиннее фото и половины страницы: лишние короткие описания уходят в «Особенности
  // и комплектация» (rest) — строка таблицы не разрывается и не должна быть выше страницы
  function heroXml(it, m, feats, opts, rest) {
    const kp = BLK.equipKeyParams ? keyParams(it) : [];
    const [wl, wg, wr] = m.tile ? cols([4700, 340, 5307]) : [0, 0, W];
    const [cx, cy] = m.tile ? fit(m.tile, Math.min(cm(RULES.equipPhotoWidthCm), (wl - 280) * E), cm(RULES.heroPhotoHeightCm)) : [0, 0];
    if (m.tile && rest) {
      const fh = f => (f.label ? Fit.h(f.label, wr, 'featureLabel', 259, 140, 30) : 0) + Fit.h(f.text || '', wr, 'featureText', 250);
      let est = (m.logo && BLK.equipLogo ? 760 : 0) + (kp.length ? Math.ceil(kp.length / 2) * 640 + 200 : 0) + feats.reduce((a, f) => a + fh(f), 0) +
        (opts.length ? Fit.h(T.equipOptionsTitle, wr, 'featureLabel', 259, 160, 30) + opts.reduce((a, o) => a + Fit.h('+ ' + o.name, wr - 200, 'featureText', 250, 0, 20), 0) : 0);
      const budget = Math.max(Math.round(cy / E) + 600, Math.round(PAGEH * 0.72));
      while (feats.length > 1 && est > budget) { const f = feats.pop(); est -= fh(f); rest.unshift(f); }
    }
    let right = '';
    if (m.logo && BLK.equipLogo) { const [lx, ly] = fit(m.logo, cm(RULES.logoWidthCm), 560000); right += p(img(m.logo.rid, lx, ly, 'Логотип', 'logoWidthCm'), { after: 200 }); }
    if (kp.length) right += tilesXml(kp, wr, 2) + spacer(200);
    feats.forEach((f, i) => {
      if (f.label) right += p(r(f.label, 'featureLabel'), { before: i ? 140 : 0, after: 30, keep: true });
      right += Typo.paras(f.text || '', 'featureText', { line: 250, hy: true, before: !f.label && i ? 140 : 0 });
    });
    if (opts.length) {
      right += p(r(T.equipOptionsTitle, 'featureLabel'), { before: feats.length ? 160 : 0, after: 30, keep: true });
      opts.forEach(o => { right += optPara(o.name, 'featureText'); });
    }
    if (!m.tile) return right;
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
      const tx = tc((f.label ? p(r(f.label, 'componentLabel'), { after: 60, keep: true }) : '') + Typo.paras(f.text || '', 'componentText', { line: 252, hy: true }), wt, { va: 'center', mar: [40, 0, 40, 0] });
      if (n) out.push(spacer(160));
      out.push(tbl([[pic, gapCell(wg), tx]], [wi, wg, wt]));
    });
    return out.join('');
  }

  // особенности и комплектация: список «подзаголовок слева — текст справа»
  function featuresXml(list) {
    const [wl, wt] = cols([2500, 7847]);
    const rows = list.map((f, i) => {
      const bd = i < list.length - 1 ? B(null, null, [4, HAIR]) : B();
      const row = [tc(p(r(f.label || '', 'featureLabel'), { line: 240 }), wl, { bdr: bd, va: 'top', mar: [120, 0, 120, 200] }),
        tc(Typo.paras(f.text || '', 'featureText', { line: 252, hy: true }), wt, { bdr: bd, va: 'top', mar: [110, 0, 120, 0] })];
      return i === 0 && list.length > 1 && String(f.text || '').length < 400 ? keepRow(row) : row;
    });
    return subheading(T.featuresTitle) + tbl(rows, [wl, wt]);
  }

  // карточка группы характеристик: название группы (повторяется при переносе на новую страницу) и строки;
  // длинное значение (перечень, условия) — текстом во всю ширину карточки под названием параметра
  function specCard(g, w) {
    const wk = Math.round(w * 0.55), wv = w - wk, n = g.rows.length;
    const title = g.cont ? txt('specCont', { name: g.name || T.specsTitle }) : (g.name || T.specsTitle);
    const rows = [keepRow([tc(p(r(title, 'specGroup'), { line: 240 }), w, { span: 2, fill: LIGHT, bdr: B(null, [36, BLUE]), mar: [90, 140, 80, 140] })])];
    g.rows.forEach((x, i) => {
      const bd = i === n - 1 ? B(null, null, [4, LINE]) : B(null, null, [4, HAIR]);
      const row = String(x.v || '').length > RULES.specLongValueChars
        ? [tc(p(r(x.k, 'specName'), { after: 40, line: 240, keep: true }) + Typo.paras(x.v, x.hl ? 'specValueKey' : String(x.v).length <= 70 ? 'specValue' : 'specText', { line: 250, hy: true }), w,
          { span: 2, bdr: bd, mar: [70, 140, 80, 120] })]
        : [tc(p(r(x.k, 'specName'), { line: 240 }), wk, { bdr: bd, va: 'center', mar: [50, 140, 50, 80] }),
          tc(p(r(x.v, specVal(x)), { line: 240 }), wv, { bdr: bd, va: 'center', mar: [50, 80, 50, 120] })];
      rows.push(keepTail(i, n) ? keepRow(row) : row);
    });
    return tbl(rows, [wk, wv], { header: true });
  }
  // высота карточки (твипы) при ширине w — для раскладки групп по двум колонкам: каждая следующая — в более короткую
  const cardH = (g, w) => {
    const wk = Math.round(w * 0.55), wv = w - wk;
    return 380 + g.rows.reduce((a, x) => {
      const k = String(x.k || ''), v = String(x.v || '');
      if (v.length > RULES.specLongValueChars) return a + 150 + Fit.h(k, w - 260, 'specName', 240, 0, 40) + Fit.h(v, w - 260, x.hl ? 'specValueKey' : v.length <= 70 ? 'specValue' : 'specText', 250);
      return a + 100 + Math.max(Fit.h(k, wk - 220, 'specName', 240), Fit.h(v, wv - 200, specVal(x), 240));
    }, 0);
  };
  function specsXml(groups) {
    // пояснение «Синим выделены ключевые параметры…» — справа в строке заголовка: не отрывается от таблицы
    const out = [subheading(T.specsTitle, null, null, BLK.specNote ? T.specNote : '')];
    const nrows = groups.reduce((a, g) => a + g.rows.length + 1, 0);
    if (nrows < RULES.specTwoColumnsFrom) {
      groups.forEach((g, i) => { if (i) out.push(spacer(160)); out.push(specCard(g, W)); });
    } else {
      // карточки групп — в две независимые колонки, каждая следующая — в ту, что короче;
      // группа больше половины всех строк делится пополам: вторая половина — «… (продолжение)»
      const gs = [];
      for (const g of groups) {
        if (g.rows.length >= 8 && g.rows.length + 1 > nrows * 0.55) { const k = Math.ceil(g.rows.length / 2); gs.push({ name: g.name, rows: g.rows.slice(0, k) }, { name: g.name, rows: g.rows.slice(k), cont: true }); }
        else gs.push(g);
      }
      const [c1, cg, c2] = cols([5073, 201, 5073]), A = [], Bc = [];
      let ha = 0, hb = 0;
      for (const g of gs) { const h = cardH(g, c1) + 200; if (ha <= hb) { A.push(g); ha += h; } else { Bc.push(g); hb += h; } }
      const stack = (list, w) => list.map((g, i) => (i ? spacer(200) : '') + specCard(g, w)).join('') + END;
      out.push(tbl([[tc(stack(A, c1), c1, { va: 'top', mar: NOM }), gapCell(cg), tc(stack(Bc, c2), c2, { va: 'top', mar: NOM })]], [c1, cg, c2], { split: true }));
    }
    return out.join('');
  }

  // фото и схемы: карточки по 2 в ряд (от трёх фото — по 3, ниже), схемы и чертежи — на всю ширину;
  // ряд переносится на новую страницу целиком, неполный ряд — по центру; лист ЕСКД (g.sheet — габаритный чертёж,
  // схема станции: формат А4) — во всю ширину и почти во всю высоту страницы, чтобы подписи и размеры читались
  function galleryXml(list) {
    if (!list || !list.length) return '';
    const out = [subheading(T.galleryTitle)];
    const per = list.filter(g => !g.wide).length >= 3 ? 3 : 2, GAP = X(201), CW = Math.floor((W - GAP * (per - 1)) / per), FULL = W;
    const card = (g, w, boxW, boxH) => {
      const [cx, cy] = fit(g, boxW, boxH);
      const body = p(img(g.rid, cx, cy, g.caption || 'Изображение'), { jc: 'center', after: g.caption ? 80 : 0 }) +
        (g.caption ? p(r(g.caption, 'galleryCaption'), { jc: 'center', line: 240 }) : '');
      return tc(body, w, { bdr: B(FRAME, FRAME, FRAME, FRAME), va: 'center', mar: [140, 120, 140, 120] });
    };
    const box = [(CW - 260) * E, per === 3 ? 1450000 : list.length <= 2 ? 1450000 : 1850000], fullBox = [(FULL - 260) * E, 3600000], sheetBox = [(FULL - 260) * E, Math.max(7200000, Math.min(8600000, PAGEH * E - 1300000))];
    // раскладка: обычные фото рядами по порядку; широкое изображение, попавшее внутрь ряда, ставится после него
    const rows = [], deferred = [];
    let cur = [];
    for (const g of list) {
      if (g.wide) { if (cur.length) deferred.push(g); else rows.push([g]); continue; }
      cur.push(g);
      if (cur.length === per) { rows.push(cur); cur = []; while (deferred.length) rows.push([deferred.shift()]); }
    }
    if (cur.length) rows.push(cur);
    while (deferred.length) rows.push([deferred.shift()]);
    rows.forEach((row, n) => {
      if (n) out.push(spacer(160));
      if (row[0].wide) { out.push(tbl([[card(row[0], FULL, ...(row[0].sheet ? sheetBox : fullBox))]], [FULL])); return; }
      const used = row.length * CW + (row.length - 1) * GAP, side = Math.floor((FULL - used) / 2), cells = [], ws = [];
      if (side > 0) { cells.push(gapCell(side)); ws.push(side); }
      row.forEach((g, i) => { if (i) { cells.push(gapCell(GAP)); ws.push(GAP); } cells.push(card(g, CW, ...box)); ws.push(CW); });
      if (FULL - used - side > 0) { cells.push(gapCell(FULL - used - side)); ws.push(FULL - used - side); }
      out.push(tbl([cells], ws));
    });
    return out.join('');
  }

  // ---------------------------------------------------------------- СБОРКА (изделие из нескольких элементов)
  // it.kit.parts — элементы: {id, name, qty, desc, rows:[{k,v}], maker, model}; фото — m.kitImgs[id].
  // Таблица «Состав изделия» — что входит и главное о каждом элементе одной строкой; карточки — описание и все характеристики.
  const kitOf = it => (it && it.kit && Array.isArray(it.kit.parts) ? it.kit.parts : []).filter(x => x && String(x.name || '').trim());
  const kitName = x => x.name + (+x.qty > 1 ? ' × ' + x.qty : '');
  // характеристики «параметр — значение»: короткие — сеткой (в две пары колонок, если их больше шести),
  // длинные (перечни, описания систем) — абзацами во всю ширину под сеткой
  class KV {
    static xml(rows, wt) {
      const isShort = z => String(z.v || '').length <= 40 && String(z.k || '').length <= 48;
      const short = rows.filter(isShort), long = rows.filter(z => !isShort(z));
      let x = short.length ? KV.grid(short, wt, short.length > 6) + END : '';
      long.forEach((z, i) => { x += p(r(z.k, 'specName'), { before: i || short.length ? 80 : 0, after: 20, keep: true, line: 240 }) +
        Typo.paras(z.v, z.hl ? 'specValueKey' : String(z.v).length <= 70 ? 'specValue' : 'specText', { line: 250, hy: true }); });
      return x;
    }
    static grid(rows, wt, two) {
      const per = two ? Math.ceil(rows.length / 2) : rows.length, w1 = two ? Math.floor((wt - 160) / 2) : wt;
      const kv = (z, w) => { const wk = Math.round(w * 0.55), bd = B(null, null, z ? [4, HAIR] : null);
        return [tc(p(r(z ? z.k : '', 'specName'), { line: 240 }), wk, { bdr: bd, mar: [40, 0, 40, 80] }),
          tc(p(r(z ? z.v : '', z && z.hl ? 'specValueKey' : 'specValue'), { line: 240 }), w - wk, { bdr: bd, mar: [40, 60, 40, 0] })]; };
      const tr = [];
      for (let i = 0; i < per; i++) tr.push(two ? kv(rows[i], w1).concat([gapCell(wt - 2 * w1)], kv(rows[i + per], w1)) : kv(rows[i], w1));
      const ws = two ? [Math.round(w1 * 0.55), w1 - Math.round(w1 * 0.55), wt - 2 * w1, Math.round(w1 * 0.55), w1 - Math.round(w1 * 0.55)] : [Math.round(wt * 0.55), wt - Math.round(wt * 0.55)];
      return tbl(tr, ws);
    }
  }
  function kitXml(it, m) {
    const parts = kitOf(it), imgs = m.kitImgs || {}, out = [];
    if (BLK.equipKit) {
      out.push(subheading(T.kitTitle));
      const wc = cols([520, 3900, 1000, 4927]), HL = B(null, null, [4, HAIR]), Mr = [90, 100, 90, 100];
      const head = [T.colNo, T.kitColName, T.colQty, T.kitColParams].map((t, i) => HDR(t, wc[i], i === 0 || i === 2 ? 'center' : 'left'));
      const rows = [head].concat(parts.map((x, i) => {
        const short = (x.rows || []).filter(z => String(z.v).length <= 40), main = short.filter(z => !/^(модель|марка|производитель|тип|бренд)/i.test(z.k));
        const key = (main.length ? main : short).slice(0, Math.max(0, +RULES.kitKeyParams || 0)).map(z => z.k + ': ' + z.v).join('; ');
        const sub = [x.maker, x.model].filter(Boolean).join(' ');
        const row = [tc(p(r(String(i + 1), 'rowIndex'), { jc: 'center' }), wc[0], { bdr: HL, mar: Mr }),
          tc(p(r(x.name, 'cellBold'), { line: 240 }) + (sub && !x.name.includes(sub) ? p(r(sub, 'muted'), { before: 20, line: 240 }) : ''), wc[1], { bdr: HL, mar: Mr }),
          tc(p(r((+x.qty || 1) + NB + T.pcs, 'cell'), { jc: 'center' }), wc[2], { bdr: HL, mar: Mr }),
          tc(p(r(key || '—', key ? 'specText' : sty('specText', { color: GRAY })), { line: 240 }), wc[3], { bdr: HL, mar: Mr })];
        return keepTail(i, parts.length) ? keepRow(row) : row;
      }));
      out.push(tbl(rows, wc, { header: true, minH: { 0: 400 } }));
    }
    // карточки элементов: фото (если есть) слева, справа — название, описание и характеристики
    // card === false — элемент только в таблице состава (станция: фильтры, обвязка, шкафы, контейнер); rowsKp — ключевые характеристики
    const cards = BLK.equipKitCards ? parts.filter(x => x.card !== false && (x.desc || (x.rowsKp || x.rows || []).length || imgs[x.id])) : [];
    if (cards.length) {
      out.push(subheading(T.kitCardsTitle));
      cards.forEach((x, n) => {
        const g = imgs[x.id], wi = g ? Math.round(RULES.kitPhotoWidthCm * 567) : 0, wg = g ? X(240) : 0, wt = W - wi - wg;
        let body = p(r((n + 1) + '. ' + kitName(x), 'componentLabel'), { after: 60, keep: true });
        if (x.maker && !x.name.includes(x.maker)) body += p(r(txt('kitMaker', { maker: [x.maker, x.model].filter(Boolean).join(' ') }), 'muted'), { after: 60 });
        if (x.desc) body += Typo.paras(x.desc, 'componentText', { line: 252, hy: true, after: (x.rowsKp || x.rows || []).length ? 80 : 0 });
        const kr = x.rowsKp || x.rows || []; if (kr.length) body += KV.xml(kr, g ? wt : wt - 200) + END;
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

  // ---------------------------------------------------------------- КАРТОЧКА НЕБОЛЬШОЙ ПОЗИЦИИ
  // Запчасти, фильтры, ресиверы и другие позиции с небольшим описанием, когда страниц оборудования много:
  // «фото слева — описание и характеристики справа», по две-три карточки на странице вместо полупустой страницы
  // на каждую. Карточка не разрывается: не помещается — целиком переходит на следующую страницу.
  class Card {
    static fits(it, m) {
      if (!RULES.compactCards || kitOf(it).length) return false;
      const fimg = m.featImgs || {}, F = (it.features || []).filter(f => f.label || f.text);
      if (BLK.equipComponents && F.some(f => f.id && fimg[f.id])) return false;
      const rows = (it.groups || []).reduce((a, g) => a + (g.rows || []).filter(x => x.k || x.v).length, 0);
      const chars = F.reduce((a, f) => a + String(f.text || '').length + String(f.label || '').length, 0);
      return rows <= RULES.compactMaxRows && chars <= RULES.compactMaxChars && ((BLK.equipGallery && m.gallery) || []).length <= 2;
    }
    // pbb — с новой страницы (первая позиция раздела); after — карточка идёт после полной страницы позиции
    static xml(it, m, pbb, after) {
      const title = p(r(it.pageTitle || it.name, 'cardTitle'), { pbb, keep: true, line: 240, after: 140, before: pbb ? 0 : after ? 480 : 0,
        bdr: `<w:bottom w:val="single" w:sz="6" w:space="4" w:color="${LINE}"/>` });
      const gal = BLK.equipGallery ? (m.gallery || []) : [];
      const [wl, wg, wr] = m.tile || gal.length ? cols([3500, 300, 6547]) : [0, 0, W];
      // слева — фото, под ним картинки галереи (две — рядом); справа — логотип, описание, опции, характеристики
      let left = '';
      if (m.tile) { const [cx, cy] = fit(m.tile, (wl - 240) * E, cm(3.0)); left += p(img(m.tile.rid, cx, cy, it.name), { jc: 'center' }); }
      if (gal.length) {
        const two = gal.length === 2, gw = two ? Math.floor((wl - 240) / 2) : wl - 240;
        left += p(gal.map(g => { const [cx, cy] = fit(g, (gw - 80) * E, cm(m.tile ? 1.7 : 2.6)); return img(g.rid, cx, cy, g.caption || it.name); }).join(two ? '<w:r><w:t xml:space="preserve">  </w:t></w:r>' : ''),
          { jc: 'center', before: m.tile ? 120 : 0 });
        const caps = gal.map(g => g.caption).filter(Boolean);
        if (caps.length) left += p(r(caps.join(' · '), 'photoCaption'), { jc: 'center', before: 40, line: 240 });
      }
      let right = '';
      if (m.logo && BLK.equipLogo) { const [lx, ly] = fit(m.logo, cm(Math.min(+RULES.logoWidthCm || 3, 2.6)), 330000); right += p(img(m.logo.rid, lx, ly, 'Логотип', 'logoWidthCm'), { after: 100 }); }
      // описание: подзаголовок в начале абзаца («НАЗНАЧЕНИЕ  Фильтр масляный…») — карточка короче на строку на каждый блок
      (it.features || []).filter(f => f.label || f.text).forEach((f, i) => {
        const tx = String(f.text || ''), list = tx.split(/\r?\n/).some(l => Typo.ITEM.test(l));
        if (f.label && (list || !tx.trim())) right += p(r(f.label, 'featureLabel'), { before: i ? 80 : 0, after: 30, keep: true });
        if (!tx.trim()) return;
        if (f.label && !list) right += p(r(f.label, 'featureLabel') + r(NB + NB + tx.trim(), 'featureText'), { before: i ? 80 : 0, line: 250, hy: true });
        else right += Typo.paras(tx, 'featureText', { line: 250, hy: true, before: !f.label && i ? 80 : 0 });
      });
      const opts = BLK.equipOptions ? (it.options || []).filter(o => o.name && +o.qty > 0) : [];
      if (opts.length) { right += p(r(T.equipOptionsTitle, 'featureLabel'), { before: 100, after: 30, keep: true }); opts.forEach(o => { right += optPara(o.name, 'featureText'); }); }
      const groups = BLK.equipSpecs ? (it.groups || []).map(g => ({ name: g.name, rows: (g.rows || []).filter(x => x.k || x.v) })).filter(g => g.rows.length) : [];
      groups.forEach((g, i) => {
        right += p(r(groups.length > 1 && g.name ? g.name : T.specsTitle, 'specGroup'), { before: i || right ? 140 : 0, after: 50, keep: true, line: 240 });
        right += KV.xml(g.rows, wr);
      });
      const body = wl
        ? tbl([[tc(left, wl, { fill: LIGHT, va: 'top', mar: [140, 120, 140, 120] }), gapCell(wg), tc(right + END, wr, { va: 'top', mar: NOM })]], [wl, wg, wr])
        : right + END;
      return title + body + spacer(300);
    }
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
    const rest = [];
    out.push(heroXml(it, m, feats, opts, BLK.equipFeatures ? rest : null));
    // сборное изделие (it.asm): сначала изделие целиком — описание и сводные характеристики, затем состав и карточки частей
    const kitAt = it.asm ? 'end' : 'start';
    if (kitOf(it).length && kitAt === 'start') out.push(kitXml(it, m));
    if (illustrated.length) out.push(componentsXml(illustrated, fimg));
    if ((rest.length || longF.length) && BLK.equipFeatures) out.push(featuresXml(rest.concat(longF)));
    const groups = BLK.equipSpecs ? (it.groups || []).map(g => ({ name: g.name, rows: (g.rows || []).filter(x => x.k || x.v) })).filter(g => g.rows.length) : [];
    if (groups.length) out.push(specsXml(groups));
    if (kitOf(it).length && kitAt === 'end') out.push(kitXml(it, m));
    if (BLK.equipGallery) out.push(galleryXml(m.gallery));
    return out.join('');
  }
  function hasEquipPage(it, M) {
    const m = M.items[it.id];
    return it.page && ((it.options || []).some(o => o.name) || kitOf(it).length || (it.groups && it.groups.some(g => g.rows && g.rows.some(x => x.k || x.v))) ||
      (m && m.tile) || ((m && m.gallery) || []).length || Object.keys((m && m.featImgs) || {}).length || (it.features || []).some(f => f.text));
  }
  // раздел «Оборудование»: большая позиция — со своей страницы; небольшие (Card.fits) — карточками подряд, в том числе
  // на свободном месте последней страницы большой позиции; карточки — когда страниц оборудования не меньше compactFrom
  // (одна-две позиции — всегда полной страницей)
  function equipmentXml(S, M) {
    const list = S.items.filter(it => hasEquipPage(it, M)), cards = list.length >= RULES.compactFrom;
    let prev = null;
    return list.map((it, i) => {
      const m = M.items[it.id] || {};
      if (cards && Card.fits(it, m)) { const x = Card.xml(it, m, i === 0, prev === 'page'); prev = 'card'; return x; }
      prev = 'page';
      return equipXml(it, M);
    }).join('');
  }

  // ================================================================ КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ
  // Шапка таблицы повторяется на каждой странице; позиция с составом и опциями не разрывается;
  // последняя позиция, итоги, «Итого к оплате» и сумма прописью держатся вместе (итоги не уходят на новую страницу одни)
  function offerXml(S, sec) {
    const out = [headingFor(T.offerTitle, sec, 480)], t = totals(S.items, S.vat);
    // скидка для заказчика: колонка «Скидка» и строки «Сумма без скидки» / «Скидка»;
    // если блок скидки выключен в шаблоне — в колонке цены сразу цена со скидкой
    const showD = BLK.discount && t.discount > 0;
    const unitP = it => showD ? it.price : netPrice(it);
    const wc = showD ? cols([560, 3787, 1100, 1800, 1300, 1800]) : cols([560, 4787, 1200, 1900, 1900]);
    const n = wc.length, wSum = (a, b) => wc.slice(a, b).reduce((x, y) => x + y, 0);
    // много позиций — строки плотнее (таблица короче на страницы)
    const pad = S.items.length > 12 ? 120 : 230, HL = B(null, null, [4, HAIR]), Mr = [pad, 120, pad, 120];
    const cur = curSh(S), pcs = NB + T.pcs;
    const discCell = (it, w, o) => {
      const d = unitDisc(it);
      const tx = !d ? '—' : it.disc.type === 'sum' ? '−' + money(d) : '−' + String(it.disc.v).replace('.', ',') + NB + '%';
      return tc(p(r(tx, d ? 'cell' : sty('cell', { color: GRAY })), { jc: 'right' }), w, o);
    };
    const head = [HDR(T.colNo, wc[0], 'center'), HDR(T.colName, wc[1]), HDR(T.colQty, wc[2], 'center'), HDR(txt('colPrice', { cur }), wc[3], 'right')]
      .concat(showD ? [HDR(T.colDisc, wc[4], 'right')] : [], [HDR(txt('colSum', { cur }), wc[n - 1], 'right')]);
    const groups = S.items.map((it, i) => {
      const g = [];
      const nm = p(r(it.name, 'itemName'), { after: it.spec ? 40 : 0 }) + (it.spec ? p(r(it.spec, 'muted'), { hy: true }) : '');
      g.push([tc(p(r(String(i + 1), 'rowIndex'), { jc: 'center' }), wc[0], { bdr: HL, mar: Mr }), tc(nm, wc[1], { bdr: HL, mar: Mr }),
        tc(p(r(it.qty + pcs, 'cell'), { jc: 'center' }), wc[2], { bdr: HL, mar: Mr }),
        tc(p(r(money(unitP(it)), 'cell'), { jc: 'right' }), wc[3], { bdr: HL, mar: Mr })]
        .concat(showD ? [discCell(it, wc[4], { bdr: HL, mar: Mr })] : [],
          [tc(p(r(money(it.qty * netPrice(it)), 'cellBold'), { jc: 'right' }), wc[n - 1], { bdr: HL, mar: Mr })]));
      if (BLK.offerKit) kitOf(it).forEach(x => {
        const Mo = [70, 120, 70, 120], free = sty('option', { color: GRAY });
        g.push([tc('', wc[0], { bdr: HL, mar: Mo }), tc(p(r('·', 'option') + '<w:r><w:tab/></w:r>' + r(x.name, 'option'), { indL: 400, hang: 200, tab: 400 }), wc[1], { bdr: HL, mar: Mo }),
          tc(p(r((+x.qty || 1) * (+it.qty || 1) + pcs, 'option'), { jc: 'center' }), wc[2], { bdr: HL, mar: Mo }),
          tc(p(r(T.kitInOffer, free), { jc: 'right' }), wc[3], { bdr: HL, mar: Mo })]
          .concat(showD ? [tc('', wc[4], { bdr: HL, mar: Mo })] : [], [tc(p(r('—', free), { jc: 'right' }), wc[n - 1], { bdr: HL, mar: Mo })]));
      });
      (it.options || []).filter(o => o.name && +o.qty > 0).forEach((o, j) => {
        const Mo = [110, 120, 110, 120], free = sty('option', { color: GRAY });
        const nm2 = optPara(o.name, 'option', { indL: 400, tab: 400, after: o.note ? 30 : 0, line: null }) + (o.note ? p(r(o.note, 'optionNote'), { indL: 400, hy: true }) : '');
        g.push([tc(p(r(`${i + 1}.${j + 1}`, 'muted'), { jc: 'center' }), wc[0], { bdr: HL, mar: Mo }), tc(nm2, wc[1], { bdr: HL, mar: Mo }),
          tc(p(r(o.qty + NB + (o.unit || T.pcs), 'option'), { jc: 'center' }), wc[2], { bdr: HL, mar: Mo }),
          tc(p(r(o.price ? money(o.price) : T.included, o.price ? 'option' : free), { jc: 'right' }), wc[3], { bdr: HL, mar: Mo })]
          .concat(showD ? [tc('', wc[4], { bdr: HL, mar: Mo })] : [],
            [tc(p(r(o.price ? money(o.qty * o.price) : '—', o.price ? 'option' : free), { jc: 'right' }), wc[n - 1], { bdr: HL, mar: Mo })]));
      });
      return g;
    });
    const rows = [head];
    groups.forEach((g, gi) => g.forEach((row, k) => rows.push(k < g.length - 1 || gi === groups.length - 1 ? keepRow(row) : row)));
    const lbl = (tx, span, w) => tc(p(r(tx, 'totalLabel'), { jc: 'right' }), w, { span, mar: [90, 120, 60, 160] });
    if (showD) {
      rows.push(keepRow([lbl(T.subtotal, n - 1, wSum(0, n - 1)), tc(p(r(money(t.gross), sty('totalValue', { b: false })), { jc: 'right' }), wc[n - 1], { mar: [90, 120, 30, 120] })]));
      rows.push(keepRow([lbl(T.discountTotal, n - 1, wSum(0, n - 1)), tc(p(r('−' + money(t.discount), 'totalValue'), { jc: 'right' }), wc[n - 1], { mar: [30, 120, 30, 120] })]));
    }
    rows.push(keepRow([lbl(T.total, 2, wc[0] + wc[1]), tc(p(r(t.units + pcs, 'totalValue'), { jc: 'center' }), wc[2], { mar: [90, 120, 60, 120] })]
      .concat(wc.slice(3, n - 1).map(w => tc('', w, { mar: [90, 120, 60, 120] })), [tc(p(r(money(t.sum), 'totalValue'), { jc: 'right' }), wc[n - 1], { mar: [90, 120, 60, 120] })])));
    rows.push(keepRow([lbl(txt('vatIncl', { vat: S.vat }), n - 1, wSum(0, n - 1)), tc(p(r(money(t.vat), sty('totalValue', { b: false })), { jc: 'right' }), wc[n - 1], { mar: [60, 120, 60, 120] })]));
    out.push(tbl(rows, wc, { minH: { 0: 440 }, header: true }));
    const L4 = wSum(0, n - 1);
    const C = CURS[curCode(S)], rt = S.cur && +S.cur.rate;
    const inWords = BLK.amountInWords ? r(T.inWordsLabel, 'wordsLabel') + r(txt('inWords', { words: words(t.sum, curCode(S)), vat: S.vat, vatSum: money(t.vat), cur }), 'words') : '';
    const note = curCode(S) !== 'RUB' && BLK.currencyNote ? txt('currencyNote', { curName: C.name }) +
      (rt ? txt('currencyRate', { rateDate: S.cur.date ? ' на ' + ruDate(S.cur.date) : '', cur: C.sh, rate: String(rt).replace('.', ','), rub: money(Math.round(t.sum * rt)) }) : '') : '';
    // «Итого к оплате», сумма прописью и примечание о валюте — одной неразрывной строкой-контейнером:
    // не расходятся по страницам ни в Word, ни в LibreOffice
    const band = bgpara(W, 640, BLUE, 120, 120) + tbl([[tc(p(r(T.grandTotal, 'grandLabel'), { jc: 'right' }), L4, { mar: [0, 120, 0, 160] }),
      tc(p(r(money(t.sum), 'grandSum'), { jc: 'right' }), wc[n - 1], { mar: [0, 120, 0, 120] })]], [L4, wc[n - 1]], { heights: { 0: 640 } }) +
      (inWords ? p(inWords, { before: 140, line: 250, hy: true }) : '') + (note ? p(r(note, 'note'), { before: 60, line: 250, hy: true }) : '') + (inWords || note ? '' : END);
    out.push(tbl([[tc(band, W, { mar: NOM, va: 'top' })]], [W]));
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
    // первые две и последние две строки — вместе: строка условий не остаётся одна на странице
    if (conds.length) x += tbl(conds.map((c, i) => {
      const bd = i === conds.length - 1 ? B() : B(null, null, [4, HAIR]), n = conds.length;
      const row = [tc(p(r(c.label, 'condLabel')), w2[0], { bdr: bd, mar: [130, 120, 130, 120] }), tc(Typo.paras(c.value, 'condValue', { hy: true }), w2[1], { bdr: bd, mar: [130, 120, 130, 120] })];
      return i < n - 1 && (i === 0 || i >= n - 2) ? keepRow(row) : row;
    }), w2);
    if (extra.length) {
      x += p(r(T.condExtraTitle, 'condLabel'), { before: conds.length ? 260 : 60, after: 90, indL: 120, keep: true });
      x += Typo.paras(extra.join('\n'), 'condValue', { line: 260, indL: 120, gap: 70, hy: true, tail: true });
    }
    return x;
  }

  // ================================================================ КОНТАКТНАЯ ИНФОРМАЦИЯ
  // плашка по высоте текста: длинная должность или адрес не обрезаются; телефоны — одной строкой
  // подпись и печать картинками: печать плавает поверх подписи, как на бумаге
  function signXml(M, floats) {
    const g = M.sign || {};
    if (!g.sign && !g.stamp) return '';
    const sign = g.sign ? img(g.sign.rid, cm(RULES.signWidthCm || 3.5), Math.round(cm(RULES.signWidthCm || 3.5) * g.sign.h / g.sign.w), 'Подпись') : '';
    let stamp = '';
    if (g.stamp) {
      const id = ++PID, cx = cm(RULES.stampWidthCm || 4), cy = Math.round(cx * g.stamp.h / g.stamp.w);
      floats.push({ kind: 'img', id: 'stamp', behind: false });
      stamp = anchorRun(picXml(id, g.stamp.rid, cx, cy, 'Печать'), id, cx, cy, +RULES.stampX || 0, +RULES.stampY || 0, 'Печать', '', false);
    }
    return p(stamp + r(T.signLine + NB, 'contactLabel') + sign, { before: 240 });
  }

  function contactsXml(S, sec, M, floats) {
    const out = [headingFor(T.contactsTitle, sec, 520)];
    const m = S.manager || {};
    const LBL = tx => p(r(tx, 'contactLabel'), { after: 50 });
    const ch = (lab, val, w, first, lastRow) => tc(LBL(lab) + p(val, { line: 240 }), w, { bdr: B([4, LINE]), va: 'top', mar: [200, first ? 0 : 200, lastRow ? 40 : 200, 120] });
    const tw = cols([6400, 3347]);
    const top = tbl([[tc(p(r(m.name, 'managerName'), { after: 60, line: 240 }) + p(r(m.position || '', 'managerPost'), { line: 250 }), tw[0], { va: 'bottom', mar: [0, 0, 220, 0] }),
      tc(p(r(T.closing1, 'closing'), { jc: 'right', line: 250 }) + p(r(T.closing2, 'closing'), { jc: 'right', line: 250 }), tw[1], { va: 'bottom', mar: [0, 0, 220, 0] })]], tw);
    const cw = cols([3149, 3149, 3449]);
    const dash = r('—', 'contactValue');
    const phone = Typo.solid(m.phone || '', 'contactPhone') + (m.ext ? r(txt('ext', { ext: m.ext }), 'contactExt') : '');
    const grid = tbl([[ch(T.phone, phone, cw[0], true), ch(T.mobile, m.mobile ? Typo.solid(m.mobile, 'contactPhone') : r('—', 'contactPhone'), cw[1]),
      ch(T.email, m.email ? hyper('rIdMail', r(m.email, 'contactLink')) : dash, cw[2])],
    [ch(T.site, m.site ? hyper('rIdSite', r(m.site, 'contactLink')) : dash, cw[0], true, true),
      ch(T.hours, r(m.hours || '—', 'contactValue'), cw[1], false, true), ch(T.address, r(m.address || '—', 'contactValue'), cw[2], false, true)]], cw);
    const cellH = (lab, tx, st, w, last) => 200 + (last ? 40 : 200) + Fit.h(lab, w, 'contactLabel', 259, 0, 50) + Fit.h(tx || '—', w, st, 240);
    const hTop = 220 + Math.max(Fit.h(m.name || ' ', tw[0], 'managerName', 240, 0, 60) + Fit.h(m.position || ' ', tw[0], 'managerPost', 250), Fit.h(T.closing1 + '\n' + T.closing2, tw[1], 'closing', 250));
    const r1 = Math.max(cellH(T.phone, (m.phone || '') + (m.ext ? txt('ext', { ext: m.ext }) : ''), 'contactPhone', cw[0] - 120), cellH(T.mobile, m.mobile, 'contactPhone', cw[1] - 320), cellH(T.email, m.email, 'contactLink', cw[2] - 320));
    const r2 = Math.max(cellH(T.site, m.site, 'contactLink', cw[0] - 120, true), cellH(T.hours, m.hours, 'contactValue', cw[1] - 320, true), cellH(T.address, m.address, 'contactValue', cw[2] - 320, true));
    const bh = Math.max(3420, Math.round((560 + hTop + r1 + r2) * 1.05));
    out.push(bgpara(W, bh, LIGHT, 180));
    out.push(tbl([[tc(top + grid + END, W, { va: 'top', mar: [340, 340, 200, 340] })]], [W], { heights: { 0: bh } }));
    out.push(signXml(M, floats));
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
    // клиент — коротко («ООО» вместо «Общество с ограниченной ответственностью»); колонтитул — не больше двух строк
    // (две помещаются в нижнее поле): слишком длинное название обрезается по границе слова
    const w2 = cols([6847, 3500]), cl0 = Typo.org(S.client);
    const room = 2 * Math.floor(w2[0] / (sty('footer').sz / 2 * 20 * 0.6)) - ((TPL.brandParts || []).map(x => x[0]).join('') + '   ·   ' + T.footerText + ' ').length;
    let cl = cl0;
    if (cl0.length > room) { cl = cl0.slice(0, room - 1); const sp = cl.lastIndexOf(' '); if (sp > room * 0.7) cl = cl.slice(0, sp); cl = cl.replace(/[\s,«"“„(-]+$/, '') + '…'; }
    const left = p(brandRuns('footerBrand') +
      r('   ·   ' + T.footerText + ' ', 'footer') + r(cl, 'footerClient'));
    const right = p(r((TPL.site ? TPL.site + '   ·   ' : ''), 'footer') + fld('PAGE', '1', sty('footerPage')) + r(' / ', 'footer') + fld('NUMPAGES', '1', sty('footer')), { jc: 'right' });
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
    M.sign = { sign: BLK.signImage ? reg((Min.sign || {}).sign) : null, stamp: BLK.stampImage ? reg((Min.sign || {}).stamp) : null };
    const parts = {
      cover: () => coverXml(S, M),
      clients: sec => clientsXml(S, sec),
      equipment: () => equipmentXml(S, M),
      offer: sec => offerXml(S, sec),
      conditions: sec => conditionsXml(S, sec),
      contacts: sec => contactsXml(S, sec, M, floats)
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
      media, floats,
      hyphenate: !!RULES.hyphenation    // программа включает (или выключает) автоматические переносы в настройках документа
    };
  }

  // features — что скелет умеет выводить сам; без 'discount' программа передаёт цены уже со скидкой,
  // 'header' — шапка из настроек, 'images' — дополнительные картинки, 'design' — пометки графического редактора,
  // 'kit' — сборки: состав изделия приходит как есть (it.kit.parts), а не разложенным в описание
  return { defaults: DEFAULTS, build, features: ['discount', 'header', 'images', 'design', 'kit', 'sign'] };
}
