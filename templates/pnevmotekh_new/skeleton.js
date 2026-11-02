/* ============================================================================
   СКЕЛЕТ ШАБЛОНА КП «ПНЕВМОТЕХ НОВЫЙ» — раскладка страниц документа Word.

   Этот файл лежит в папке шаблона и читается программой при каждом сохранении КП:
   правки вступают в силу сразу, без пересборки программы.

   Обычно править его не нужно: цвета, шрифт, размеры текста, все надписи, порядок
   и включение разделов, правила заполнения настраиваются в программе —
   кнопка «Настроить шаблон» (они хранятся в template.json рядом с этим файлом).
   Поля страницы, стили Word и встроенный шрифт Golos Text — в base.docx.

   Оформление: шрифт Golos Text; титул — фирменная синяя колонка слева (логотип на белом поле
   над ней, предложение, цена, главные условия, менеджер), справа — фото, состав предложения
   и получатель; внутренние страницы — узкая синяя полоса слева и шапка с номером КП и клиентом;
   «Стоимость и условия» — карточки позиций, итог светлой плашкой, условия плитками со значками;
   таблицы — со светлыми шапками; тёмно-синий — только рамка документа (колонка и полоса).

   Устройство:
     DEFAULTS            — настройки по умолчанию (template.json переопределяет любые из них);
     Cover               — титульный лист: отдельный раздел Word без полей, одна страница
                           (если не помещается — по ступеням Cover.LEFT и Cover.RIGHT меньше фото и второстепенного);
     offerXml            — «Стоимость и условия»: карточки позиций и итог к оплате;
     conditionsXml       — условия поставки плитками со значками и «Дополнительно»;
     equipXml            — страница оборудования (описание, узлы, характеристики, фото), Card — карточка
                           небольшой позиции;
     contactsXml         — контакты менеджера, «Как заказать», о компании и наши клиенты;
     headerXml           — шапка внутренних страниц (header.on): синяя полоса, логотип, номер КП и клиент;
     footerXml           — нижний колонтитул: менеджер и номер страницы;
     build               — сборка документа из разделов в порядке settings.sections (титул — всегда первым).
   Картинки шаблона (assets): значки условий и логотип титула — файлы папки шаблона (template.json → assets).
   Свои картинки и надписи шаблона (images, labels) — в начале или в конце раздела, как в шаблоне «ПНЕВМОТЕХ».
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
    name: 'ПНЕВМОТЕХ НОВЫЙ',
    description: '',
    filePrefix: 'КП',
    fileName: '{номер}_{префикс}_{клиент}_{оборудование}_{дата}',
    brandParts: [['ПНЕВМО', 'BLUE'], ['ТЕХ', 'SKY']],
    site: 'www.kompr.ru',
    font: 'Golos Text',
    fontSemi: 'Golos Text SemiBold',   // полужирное начертание (стили с semi: true); другой шрифт — обычный жирный
    colors: {
      BLUE: '0B45A0', SKY: '3DA0EE', NAVYD: '143A7F', DARK: '1F2B4D', GRAY: '66718C',
      LIGHT: 'EAF4FD', LINE: 'CFE0F2', HAIR: 'D9E6F3', WHITE: 'FFFFFF', NAVYLINE: '4F6B9F'
    },
    // порядок разделов документа; on — включён; newPage — начинать с новой страницы
    sections: [
      { id: 'cover', on: true },
      { id: 'offer', on: true, newPage: true },
      { id: 'conditions', on: true, newPage: false },
      { id: 'equipment', on: true, newPage: false },
      { id: 'contacts', on: true, newPage: false }
    ],
    // отдельные блоки внутри разделов
    blocks: {
      coverPhoto: true, coverKpis: true, coverDesc: true, coverIncluded: true, coverList: true, coverTerms: true,
      coverWhy: true, coverManager: true, coverRecipient: true, coverTrust: true, coverRequisites: true,
      equipLogo: true, equipKeyParams: true, equipOptions: true, equipKit: true, equipKitCards: true, offerKit: true,
      equipComponents: true, equipFeatures: true, equipSpecs: true, specNote: true, equipGallery: true, equipPrice: true,
      discount: true, amountInWords: true, currencyNote: true, footer: true,
      contactsHow: true, contactsAbout: true, contactsAdvantages: true,
      signImage: false, stampImage: false   // подпись и печать картинками под контактами (картинки — в «Подпись и печать»)
    },
    // правила заполнения и раскладки
    rules: {
      coverColumnCm: 8,           // ширина синей колонки титула
      coverLogoFieldCm: 3.1,      // высота белого поля с логотипом над колонкой
      coverLogoHeightCm: 1.15,    // высота логотипа на титуле
      coverPhotoHeightCm: 9.5,    // наибольшая высота фото на титуле (одна позиция)
      coverPhotoMultiCm: 7.4,     // наибольшая высота фото на титуле (несколько позиций)
      coverPhotoMaxCm: 12,        // фото титула растёт до этой высоты, если справа остаётся свободное место
      coverReserveCm: 1,          // запас внизу титула: Word раскладывает строки иначе, чем LibreOffice и предпросмотр
      coverCompactFrom: 7,        // позиций в «Составе предложения», с которых список — без фото
      coverListMax: 10,           // позиций в списке титула; больше — первые и «и ещё N…»
      coverTermsMax: 3,           // главных условий в колонке титула
      coverOptionsMax: 6,         // опций в «В предложение также входит»
      advantagesMax: 3,
      logoWidthCm: 3.75,
      equipPhotoWidthCm: 7.6,
      longFeatureChars: 230,      // описание длиннее — уходит в раздел «Особенности и комплектация»
      specTwoColumnsFrom: 15,     // строк в характеристиках, с которых карточки групп встают в две колонки
      specLongValueChars: 32,     // значение длиннее — выводится текстом во всю ширину карточки
      heroPhotoHeightCm: 6.2,     // высота главного фото на странице оборудования
      keyParamsMax: 6,            // плиток ключевых параметров рядом с фото
      keyParamMaxChars: 28,       // значения длиннее в плитки не берутся
      signWidthCm: 3.5, stampWidthCm: 4, // ширина картинок подписи и печати
      stampX: 4, stampY: -2.2,    // печать: от левого края текста и от строки подписи, см
      componentPhotoWidthCm: 4.6, componentPhotoHeightCm: 3.2,
      kitKeyParams: 3,            // характеристик элемента в таблице «Состав изделия» (полностью — в карточке элемента)
      kitPhotoWidthCm: 3.6, kitPhotoHeightCm: 2.8,
      clientsWidthCm: 7.5,        // ширина картинки «Наши клиенты» на странице контактов
      posNewPage: false,          // крупная позиция — всегда с нового листа (выключено — с того же листа, если помещаются заголовок, фото и плитки)
      specKeepRows: 4,            // таблица характеристик начинается на листе, если помещаются её заголовок и столько строк
      sparsePct: 35,              // проверка в Word: лист заполнен меньше (%) — «почти пустой» (кроме титула и последнего)
      condLongChars: 110,         // условие длиннее — плиткой во всю ширину
      compactCards: true,         // небольшие позиции — карточками по нескольку на странице (а не страница на каждую)
      compactFrom: 3,             // карточки — когда в КП столько страниц оборудования и больше
      compactMaxRows: 14,         // позиция «небольшая»: строк характеристик не больше…
      compactMaxChars: 1000,      // …и описания не длиннее (знаков), без узлов с фото и сборок
      cardHalfRows: 8,            // совсем небольшая позиция — карточкой в половину ширины, по две в ряд: строк не больше…
      cardHalfChars: 500,         // …и описания не длиннее (знаков)
      hyphenation: true           // автоматические переносы слов в описаниях (заголовки, названия, числа — без переносов)
    },
    // шапка внутренних страниц: синяя полоса слева, логотип и номер КП с клиентом справа (выключена — шапка base.docx)
    header: { on: true, logo: 'logo.png', logoWidthCm: 0, logoHeightCm: 0.66, logoSide: 'left', lines: '', textSize: 7.6, textColor: 'GRAY', firstBold: true, firstColor: 'DARK', rule: true, ruleColor: 'BLUE' },
    // картинки самого шаблона: логотип на белом поле титула и значки условий поставки (файлы папки шаблона)
    assets: { coverLogo: 'logo.png', icClock: 'ic_clock.png', icCard: 'ic_card.png', icShield: 'ic_shield.png', icTruck: 'ic_truck.png', icWrench: 'ic_wrench.png', icCalendar: 'ic_calendar.png', icNote: 'ic_note.png' },
    images: [],
    labels: [],
    imgSize: {},
    para: {},
    texts: {
      coverKicker: 'Технико-коммерческое предложение', coverFor: 'для {client}',
      coverPhones: '8 (495) 690-91-96 · 8 (800) 77-55-473',
      coverRequisites: 'ООО «ПНЕВМОТЕХ» · ИНН 9718045974 · КПП 770401001 · ОГРН 1177746081589',
      priceWithVat: 'Стоимость с НДС {vat} %', coverDiscount: 'с учётом скидки {sum} {cur}', validUntil: 'Действует до {date}',
      offerRef: 'Предложение', offerNo: '№ {number} от {date}',
      coverListTitle: 'Состав предложения', coverListSum: 'Сумма, {cur}', coverListTotal: 'Итого с НДС {vat} %',
      coverListMore: 'и ещё {n} — в разделе «{offer}»', coverIncluded: 'В предложение также входит',
      coverIncludedFree: 'включено', coverParts: 'В составе: {list}',
      coverLeadOrder: 'под заказ, до {lead}', coverLeadUpTo: 'до {lead}',
      whyTitle: 'Почему ПНЕВМОТЕХ', managerTitle: 'Ваш менеджер', mobileShort: 'моб. {phone}',
      recipient: 'Получатель', attention: 'Вниманию', object: 'Объект', inn: 'ИНН {inn}',
      trustLabel: 'Нам доверяют', pageOf: 'стр. {page} из {pages}',
      offerTitle: 'Стоимость и условия', offerLead: 'Цены в {curName}, с НДС {vat} %', offerLeadUntil: ' · действуют до {date}',
      unitPrice: '{qty} × {price}', withOptions: 'с опциями', positionTotal: 'Итого по позиции {n}',
      included: 'включено', kitInOffer: 'В составе: ', pcs: 'шт.',
      grandTotal: 'Итого к оплате с НДС', subtotalLine: 'Сумма без скидки {gross} · скидка −{discount}',
      vatIncl: 'в т. ч. НДС {vat} % — {vatSum}',
      currencyNote: 'Цены указаны в {curName}. Оплата производится в рублях по курсу ЦБ РФ на дату оплаты.',
      currencyRate: ' Справочно: курс ЦБ РФ{rateDate} — 1 {cur} = {rate} руб.; сумма в рублях — {rub} руб.',
      currencyRateOwn: ' Справочно: курс расчёта — 1 {cur} = {rate} руб.; сумма в рублях — {rub} руб.',
      conditionsTitle: 'Условия поставки', condExtraTitle: 'Дополнительно:', condUntil: ' — до {date}',
      positionKicker: 'Позиция {n} из {total}', positionQty: '{qty} шт.',
      equipOptionsTitle: 'Опции в этом КП', componentsTitle: 'Узлы и компоненты',
      kitTitle: 'Состав изделия', kitColName: 'Элемент', kitColParams: 'Основные характеристики', kitCardsTitle: 'Элементы изделия',
      kitMaker: 'Производитель: {maker}',
      featuresTitle: 'Особенности и комплектация', specsTitle: 'Технические характеристики',
      specNote: 'Синим — ключевые параметры. По данным производителя.',
      specCont: '{name} (продолжение)', galleryTitle: 'Фото и схемы', colNo: '№', colQty: 'Кол-во',
      contactsTitle: 'Контактная информация', closing1: 'С уважением и надеждой', closing2: 'на плодотворное сотрудничество',
      phone: 'Телефон', ext: ' доб. {ext}', mobile: 'Мобильный', email: 'E-mail', site: 'Сайт', hours: 'Часы работы', address: 'Адрес',
      howTitle: 'Как заказать', how1: 'Подтвердите предложение ответом на письмо или звонком менеджеру',
      how2: 'Мы пришлём договор и счёт на оплату', how3: 'Оплата и поставка — по условиям предложения', aboutTitle: 'О компании',
      signLine: 'Подпись:',
      headerKp: 'Коммерческое предложение ', headerFor: 'для ',
      footerManager: 'Ваш менеджер'
    },
    // стили текста: size — пт, color — ключ цвета (BLUE…) или HEX, spacing — разрядка, пт; semi — полужирный
    styles: {
      heading: { size: 15, color: 'BLUE', semi: true },
      lead: { size: 8.4, color: 'GRAY' },
      subheading: { size: 10.5, color: 'DARK', semi: true },
      subAside: { size: 7, color: 'GRAY' },
      label: { size: 7, color: 'GRAY', semi: true, caps: true, spacing: 0.7 },
      muted: { size: 7.5, color: 'GRAY' },
      note: { size: 7.5, color: 'GRAY' },
      badge: { size: 7.8, color: 'WHITE', bold: true },
      badgeLarge: { size: 11.5, color: 'WHITE', bold: true },
      coverKicker: { size: 6.8, color: 'LINE', semi: true, caps: true, spacing: 0.35 },
      coverTitle: { size: 12.5, color: 'LINE' },
      coverModel: { size: 20, color: 'WHITE', semi: true },
      coverSub: { size: 9.5, color: 'LINE' },
      coverClient: { size: 11.5, color: 'WHITE', bold: true },
      navyLabel: { size: 6.9, color: 'LINE', semi: true, caps: true, spacing: 0.8 },
      coverSum: { size: 21, color: 'WHITE', bold: true },
      coverSumSmall: { size: 11.5, color: 'WHITE', bold: true },
      navyNote: { size: 7.9, color: 'LINE' },
      coverBadge: { size: 8, color: 'WHITE', semi: true },
      navyText: { size: 8.5, color: 'WHITE' },
      whyHead: { size: 7.7, color: 'WHITE', semi: true },
      whyText: { size: 7.7, color: 'LINE' },
      coverManager: { size: 10, color: 'WHITE', semi: true },
      coverManagerPost: { size: 8.6, color: 'LINE' },
      coverManagerText: { size: 8.6, color: 'WHITE' },
      coverPhone: { size: 8, color: 'BLUE', semi: true },
      coverSite: { size: 8, color: 'GRAY' },
      kpiValue: { size: 13, color: 'BLUE', bold: true },
      kpiUnit: { size: 8, color: 'GRAY', semi: true },
      kpiCaption: { size: 7.2, color: 'GRAY' },
      coverDesc: { size: 8.8, color: 'DARK' },
      coverOption: { size: 8.5, color: 'DARK' },
      listName: { size: 8.6, color: 'DARK', semi: true },
      listSpec: { size: 7.5, color: 'GRAY' },
      listSum: { size: 8.6, color: 'DARK', semi: true },
      listTotal: { size: 9, color: 'DARK', semi: true },
      listTotalSum: { size: 10.5, color: 'BLUE', semi: true },
      whoValue: { size: 8.5, color: 'DARK', semi: true },
      whoText: { size: 8.5, color: 'DARK' },
      whoSub: { size: 7.8, color: 'GRAY' },
      trustText: { size: 7.9, color: 'DARK' },
      requisites: { size: 6.9, color: 'GRAY' },
      cardName: { size: 9.6, color: 'DARK', semi: true },
      cardSpec: { size: 7.9, color: 'GRAY' },
      cardCalc: { size: 7.9, color: 'GRAY' },
      cardSum: { size: 12, color: 'DARK', bold: true },
      chip: { size: 7.4, color: 'WHITE', bold: true },
      cardLine: { size: 8.1, color: 'DARK' },
      cardLineMuted: { size: 8.1, color: 'GRAY' },
      cardSub: { size: 8.1, color: 'DARK', semi: true },
      cardParts: { size: 8, color: 'GRAY' },
      cardPartsHead: { size: 8, color: 'DARK', semi: true },
      totalTitle: { size: 10, color: 'DARK', bold: true },
      totalNote: { size: 8, color: 'GRAY' },
      totalSum: { size: 17, color: 'BLUE', bold: true },
      condText: { size: 8, color: 'DARK' },
      extraLabel: { size: 8.4, color: 'DARK', semi: true },
      extraText: { size: 8.4, color: 'DARK' },
      posTitle: { size: 15, color: 'BLUE', semi: true },
      posSum: { size: 12, color: 'DARK', bold: true },
      featureLabel: { size: 7, color: 'GRAY', semi: true, caps: true, spacing: 0.7 },
      featureText: { size: 8.8, color: 'DARK' },
      photoCaption: { size: 7, color: 'GRAY' },
      heroValue: { size: 12.6, color: 'BLUE', bold: true },
      heroUnit: { size: 8, color: 'GRAY', semi: true },
      heroLabel: { size: 7.2, color: 'GRAY' },
      componentLabel: { size: 7.5, color: 'BLUE', semi: true, caps: true, spacing: 0.7 },
      componentText: { size: 8.8, color: 'DARK' },
      tableHeader: { size: 7, color: 'DARK', semi: true, caps: true, spacing: 0.7 },
      specGroup: { size: 7, color: 'DARK', semi: true, caps: true, spacing: 0.7 },
      specName: { size: 8.3, color: 'DARK' },
      specValue: { size: 8.3, color: 'DARK', semi: true },
      specValueKey: { size: 8.3, color: 'BLUE', semi: true },
      specText: { size: 8.3, color: 'DARK' },
      galleryCaption: { size: 7, color: 'GRAY' },
      cell: { size: 8.6, color: 'DARK' },
      cellBold: { size: 8.6, color: 'DARK', semi: true },
      rowIndex: { size: 8.6, color: 'GRAY' },
      cardTitle: { size: 10.6, color: 'DARK', semi: true },
      managerName: { size: 13, color: 'DARK', semi: true },
      managerPost: { size: 8.5, color: 'GRAY' },
      closing: { size: 7.9, color: 'GRAY' },
      contactPhone: { size: 10, color: 'BLUE', semi: true },
      contactExt: { size: 8.5, color: 'GRAY' },
      contactLink: { size: 10, color: 'BLUE', semi: true },
      contactValue: { size: 9, color: 'DARK' },
      howNumber: { size: 8, color: 'NAVYD', bold: true },
      howText: { size: 8, color: 'DARK' },
      about: { size: 8.8, color: 'DARK' },
      aboutBrand: { size: 8.8, color: 'DARK', bold: true },
      advTitle: { size: 8.5, color: 'DARK', semi: true },
      advText: { size: 7.9, color: 'GRAY' },
      header: { size: 7.6, color: 'GRAY' },
      headerBold: { size: 7.6, color: 'DARK', semi: true },
      footer: { size: 7, color: 'GRAY' },
      footerBold: { size: 7, color: 'DARK', semi: true },
      footerBrand: { size: 7, color: 'DARK', bold: true },
      footerPage: { size: 7, color: 'DARK', semi: true }
    },
    about: '',
    advantages: [],
    trust: '',
    clientsTitle: 'Наши клиенты',
    closing: ''
  };

  // ---------------------------------------------------------------- текущие настройки
  let TPL = DEFAULTS, T = DEFAULTS.texts, RULES = DEFAULTS.rules, BLK = DEFAULTS.blocks;
  let BLUE, SKY, NAVYD, DARK, GRAY, LIGHT, LINE, HAIR, NAVYLINE, FRAME;
  const BASEW = 10206;       // ширина текста, под которую нарисованы пропорции (А4, поля по 1,5 см)
  let W = BASEW;             // фактическая ширина текста — из полей страницы base.docx
  let PAGEH = 14200;         // высота текста внутренней страницы (твипы) — для раскладки
  const PAGE = { w: 11906, h: 16838, left: 850, header: 624 };   // лист и поля внутренних страниц
  const E = 635, NB = ' ', CM = 360000;

  function setTemplate(t) {
    TPL = deepMerge(DEFAULTS, t || {});
    // разделы: порядок и флажки из шаблона; разделы, которых там нет, добавляются в конец
    const given = Array.isArray(t && t.sections) ? t.sections.filter(s => s && DEFAULTS.sections.some(d => d.id === s.id)) : [];
    TPL.sections = given.map(s => Object.assign({}, DEFAULTS.sections.find(d => d.id === s.id), s))
      .concat(DEFAULTS.sections.filter(d => !given.some(s => s.id === d.id)));
    T = TPL.texts; RULES = TPL.rules; BLK = TPL.blocks;
    const c = TPL.colors;
    BLUE = c.BLUE; SKY = c.SKY; NAVYD = c.NAVYD; DARK = c.DARK; GRAY = c.GRAY; LIGHT = c.LIGHT; LINE = c.LINE; HAIR = c.HAIR;
    NAVYLINE = c.NAVYLINE || '4F6B9F';
    FRAME = [6, HAIR];
    W = BASEW;
    const sect = TPL.sect || '';
    const num = re => { const m = re.exec(sect); return m ? +m[1] : 0; };
    const pw = num(/<w:pgSz[^>]*w:w="(\d+)"/), ph = num(/<w:pgSz[^>]*w:h="(\d+)"/);
    const ml = num(/<w:pgMar[^>]*w:left="(\d+)"/), mr = num(/<w:pgMar[^>]*w:right="(\d+)"/);
    const mt = num(/<w:pgMar[^>]*w:top="(\d+)"/), mb = num(/<w:pgMar[^>]*w:bottom="(\d+)"/), mh = num(/<w:pgMar[^>]*w:header="(\d+)"/);
    PAGE.w = pw || 11906; PAGE.h = ph || 16838; PAGE.left = ml || 850; PAGE.header = mh || 624;
    if (pw && ml && mr) W = pw - ml - mr;
    PAGEH = ph && mt && mb ? ph - mt - mb - 120 : 14200;
  }
  // плотнее (проверка в Word нашла титул на двух листах или почти пустые листы — «Пересобрать плотнее», S.layoutDense):
  // запас внизу титула больше, фото позиций и галереи ниже, характеристики начинаются на листе раньше, позиции — подряд
  let GAL = 1;
  function denser(level) {
    const k = Math.max(0, Math.min(DENSE.max, Math.floor(+level || 0)));
    GAL = 1 - DENSE.photo * k;
    if (!k) return;
    RULES = Object.assign({}, RULES, {
      coverReserveCm: (+RULES.coverReserveCm || 0) + DENSE.reserveCm * k,
      heroPhotoHeightCm: (+RULES.heroPhotoHeightCm || 0) * GAL,
      specKeepRows: Math.max(1, (+RULES.specKeepRows || 1) - k),
      posNewPage: false
    });
  }
  const DENSE = { max: 2, reserveCm: 1, photo: 0.15 };
  const COL = k => (TPL.colors && TPL.colors[k]) || String(k || '').replace(/^#/, '');
  // пропорциональный пересчёт ширины под фактические поля страницы
  const X = v => Math.round(v * W / BASEW);
  function cols(arr) {
    const total = X(arr.reduce((a, b) => a + b, 0)), out = arr.map(X);
    out[out.length - 1] += total - out.reduce((a, b) => a + b, 0);
    return out;
  }
  // полужирное начертание — отдельный встроенный шрифт (Golos Text SemiBold); у другого шрифта — обычный жирный
  const semiFont = () => (TPL.fontSemi && TPL.font === DEFAULTS.font ? TPL.fontSemi : '');
  // стиль текста по имени из настроек (+ разовые правки)
  function sty(name, extra) {
    const s = TPL.styles[name] || {}, semi = !s.bold && !!s.semi, sf = semi ? semiFont() : '';
    return Object.assign({ sz: Math.round((+s.size || 10) * 2), color: COL(s.color || 'DARK'), b: !!s.bold || (semi && !sf), semi: semi && !!sf, f: sf,
      i: !!s.italic, caps: !!s.caps, sp: s.spacing ? Math.round(+s.spacing * 20) : 0 }, extra || {});
  }
  const txt = (key, vars) => fill(T[key] == null ? '' : T[key], vars || {});
  const brandRuns = (styleName) => { const s = sty(styleName); return (TPL.brandParts || []).map(([t, c]) => r(t, { sz: s.sz, color: COL(c), b: s.b, f: s.f, mk: TPL.design ? 'KPS_' + styleName : '' })).join(''); };
  const brandText = () => (TPL.brandParts || []).map(x => x[0]).join('');

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
        .replace(/(\d) (?=\d{3}(?!\d))/g, '$1 ')
        .replace(/(\d) (?=(?:%|‰|°[CС]?|[A-Za-zА-Яа-яЁёµΩ³²°/]{1,7}\.?)(?=[\s,.;:)(!?»"]|$))/g, '$1 ')
        .replace(/(№|§) (?=\S)/g, '$1 ')
        .replace(/ ([—–]) /g, ' $1 ')
        .replace(Typo.SHORT, '$1 ')
        .replace(/(?<=^|[\s(«"„])т\. ([чедп])\./g, 'т. $1.')
        .replace(/(?<=^|[\s(«"„,])((?:г|ул|д|стр|корп|оф|пос|пгт|обл|пр|пер|пл|наб|ш|им|рис|табл|п|с)\.) (?=[\dА-ЯЁA-Z«"])/g, '$1 ')
        .replace(/(?<=^|\s)([А-ЯЁ]\.) (?=[А-ЯЁ])/g, '$1 ');
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
          out.push(p(marker(mk, st) + r(m[2], st), Object.assign(po, { indL: ind, hang: Typo.IND, tab0: true, jc: 'left' })));
        } else out.push(p(r(line.trim(), st), po));
      }
      return out.join('') || p(r('', st), o);
    }
    // коротко: не длиннее n знаков, обрезка по границе слова и «…»
    static short(s, n) {
      s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
      if (s.length <= n) return s;
      const cut = s.slice(0, n), sp = cut.lastIndexOf(' ');
      return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:·—–-]+$/, '') + '…';
    }
    // первая буква — прописная («два миллиона…» → «Два миллиона…»)
    static cap(s) {
      s = String(s == null ? '' : s);
      return s.charAt(0).toUpperCase() + s.slice(1);
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

  // маркер пункта (•, +, «1.») и табуляция: в Word и LibreOffice текст встаёт на висячий отступ; упоры «−отступ» и «0»
  // (позади маркера, Word их пропускает) — чтобы и предпросмотр программы (vendor/docx-preview) ставил текст туда же
  function marker(ch, st) {
    if (typeof st === 'string' && RUNSTY === null) RUNSTY = st;
    return r(ch, st) + '<w:r><w:tab/></w:r>';
  }

  // Word не сообщает высоту текста при сборке файла — она оценивается по средней ширине знака шрифта (с запасом):
  // так титул (строки точной высоты) раскладывается на одну страницу и текст не обрезается
  class Fit {
    // средняя ширина знака, твипы
    static cw(s) {
      return s.sz / 2 * 20 * (s.caps ? 0.71 : s.b ? 0.6 : s.semi ? 0.58 : 0.555) + (s.sp || 0);
    }
    // строк текста в колонке шириной w (твипы) стилем st (имя стиля или sty(...))
    static lines(text, w, st) {
      const s = typeof st === 'string' ? sty(st) : st;
      const per = Math.max(4, Math.floor(w / Fit.cw(s) * 0.92));
      return String(text == null ? '' : text).split(/\r?\n/).reduce((a, l) => a + Math.max(1, Math.ceil(l.length / per)), 0);
    }
    // высота абзаца (твипы): строки × межстрочный интервал (line — как в p(): 240 — одинарный) × запас Fit.k + отступы
    static h(text, w, st, line, before, after) {
      const s = typeof st === 'string' ? sty(st) : st;
      return Math.ceil(Fit.lines(text, w, s) * s.sz / 2 * 20 * 1.22 * (line || 240) / 240 * Fit.k) + (before || 0) + (after || 0);
    }
    // ширина строки текста (твипы) — для плашек по размеру надписи
    static width(text, st) {
      const s = typeof st === 'string' ? sty(st) : st;
      return Math.ceil(String(text || '').length * Fit.cw(s));
    }
  }

  Fit.k = 1;   // запас к высоте текста (титул — Cover.SAFE)

  // ---------------------------------------------------------------- строительные блоки Word
  // o.solid — без типографской обработки (адреса, e-mail, ссылки); o.f — шрифт (полужирный); o.shd — заливка под текстом
  function r(t, o = {}) {
    if (typeof o === 'string') { const nm = o; o = sty(o); if (TPL.design) o.mk = 'KPS_' + nm; if (RUNSTY === null) RUNSTY = nm; }
    const sz = o.sz || 20, color = o.color || DARK, f = esc(o.f || TPL.font || 'Arial');
    let rp = (o.mk ? `<w:rStyle w:val="${o.mk}"/>` : '') + `<w:rFonts w:ascii="${f}" w:eastAsia="${f}" w:hAnsi="${f}" w:cs="${f}"/>`;
    if (o.b) rp += '<w:b/><w:bCs/>';
    if (o.i) rp += '<w:i/><w:iCs/>';
    if (o.caps) rp += '<w:caps/>';
    rp += `<w:color w:val="${color}"/>`;
    if (o.sp) rp += `<w:spacing w:val="${o.sp}"/>`;
    rp += `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`;
    if (o.shd) rp += `<w:shd w:val="clear" w:color="auto" w:fill="${o.shd}"/>`;
    rp += '<w:lang w:val="ru-RU"/>';
    // перенос строки внутри короткого текста — разрыв строки (списки в описаниях — абзацами, см. Typo.paras);
    // дефис внутри кода модели («CAAD-0.7/B», «EAGLE-N») — неразрывный: код не рвётся на две строки
    const run = x => `<w:r><w:rPr>${rp}</w:rPr><w:t xml:space="preserve">${esc(x)}</w:t></w:r>`, nbh = `<w:r><w:rPr>${rp}</w:rPr><w:noBreakHyphen/></w:r>`;
    return String(t == null ? '' : t).split(/\r?\n/).map(line => Typo.codes(o.solid ? line : Typo.text(line)).split('\u0002').map(run).join(nbh)).join('<w:r><w:br/></w:r>');
  }
  // абзац: keep — не отрывать от следующего; lines — не разрывать абзац; pbb — с новой страницы; hy — можно переносить слова;
  // hang — висячий отступ (пункт списка), tab — позиция табуляции; exact — точная высота строки (line)
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
    if (o.tab || o.tab0 || o.rtab) pp += `<w:tabs>${o.tab0 ? `<w:tab w:val="left" w:pos="${-(o.indL || 0)}"/><w:tab w:val="left" w:pos="0"/>` : ''}${o.tab ? `<w:tab w:val="left" w:pos="${o.tab}"/>` : ''}${o.rtab ? `<w:tab w:val="right" w:pos="${o.rtab}"/>` : ''}</w:tabs>`;
    if (!o.hy) pp += '<w:suppressAutoHyphens/>';
    const ls = o.line ? ` w:line="${o.line}" w:lineRule="${o.exact ? 'exact' : 'auto'}"` : '';
    pp += `<w:spacing w:before="${o.before || 0}" w:after="${o.after || 0}"${ls}/>`;
    if (o.indL || o.indR || o.hang) pp += `<w:ind w:left="${o.indL || 0}" w:right="${o.indR || 0}"${o.hang ? ` w:hanging="${o.hang}"` : ''}/>`;
    pp += `<w:jc w:val="${o.jc || 'left'}"/>`;
    if (o.mark) pp += `<w:rPr><w:sz w:val="${o.mark}"/><w:szCs w:val="${o.mark}"/></w:rPr>`;
    return `<w:p><w:pPr>${pp}</w:pPr>${runs}</w:p>`;
  }
  const spacer = h => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${h}" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>`;
  const END = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>';
  const line = (side, sz, color, space) => `<w:${side} w:val="single" w:sz="${sz}" w:space="${space || 0}" w:color="${color}"/>`;
  function B(top, left, bottom, right) {
    const one = (s, v) => v ? line(s, v[0], v[1]) : `<w:${s} w:val="nil"/>`;
    return one('top', top) + one('left', left) + one('bottom', bottom) + one('right', right);
  }
  // ячейка: span — объединение по горизонтали, vm — по вертикали ('restart' | 'continue')
  function tc(content, w, o = {}) {
    const [t, l, b, rr] = o.mar || [70, 120, 70, 120];
    let pr = `<w:tcW w:w="${w}" w:type="dxa"/>`;
    if (o.span > 1) pr += `<w:gridSpan w:val="${o.span}"/>`;
    if (o.vm) pr += o.vm === 'restart' ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>';
    pr += `<w:tcBorders>${o.bdr || B()}</w:tcBorders>`;
    if (o.fill) pr += `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>`;
    pr += `<w:tcMar><w:top w:w="${t}" w:type="dxa"/><w:left w:w="${l}" w:type="dxa"/><w:bottom w:w="${b}" w:type="dxa"/><w:right w:w="${rr}" w:type="dxa"/></w:tcMar>`;
    pr += `<w:vAlign w:val="${o.va || 'center'}"/>`;
    return `<w:tc><w:tcPr>${pr}</w:tcPr>${content || '<w:p/>'}</w:tc>`;
  }
  function tbl(rows, widths, o = {}) {
    const grid = widths.map(x => `<w:gridCol w:w="${x}"/>`).join('');
    const pr = `<w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblInd w:w="${o.ind || 0}" w:type="dxa"/>` +
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
      picXml(id, rid, cx, cy, name) + '</wp:inline></w:drawing></w:r>';
  }
  // прямоугольник цвета color за текстом: в Word и LibreOffice — от края листа (page: true) или от абзаца привязки;
  // предпросмотр программы рисует запасную фигуру VML — от абзаца привязки (смещение — dx, dy, твипы)
  function rect(wd, hd, color, pos) {
    const id = ++PID, w = wd * E, h = hd * E, rel = pos.page ? 'page' : 'paragraph', relH = pos.page ? 'page' : 'column';
    const dml = `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1">` +
      `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="${relH}"><wp:posOffset>${pos.x * E}</wp:posOffset></wp:positionH>` +
      `<wp:positionV relativeFrom="${rel}"><wp:posOffset>${pos.y * E}</wp:posOffset></wp:positionV>` +
      `<wp:extent cx="${w}" cy="${h}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
      `<wp:docPr id="${id}" name="Фон ${id}"/><wp:cNvGraphicFramePr/>` +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
      `<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
      `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor>`;
    const vml = `<w:pict><v:rect id="bg${id}" o:spid="_x0000_s${id}" style="position:absolute;margin-left:${pos.dx / 20}pt;margin-top:${pos.dy / 20}pt;width:${wd / 20}pt;height:${hd / 20}pt;z-index:-${id};mso-position-horizontal-relative:text;mso-position-vertical-relative:text" fillcolor="#${color}" stroked="f"/></w:pict>`;
    return '<w:r><w:rPr><w:noProof/></w:rPr><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>' + dml +
      '</w:drawing></mc:Choice><mc:Fallback>' + vml + '</mc:Fallback></mc:AlternateContent></w:r>';
  }
  // абзац-привязка нулевой высоты (для фигур за текстом)
  const anchorPara = runs => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr>${runs}</w:p>`;
  const hyper = (rid, runs) => `<w:hyperlink r:id="${rid}">${runs}</w:hyperlink>`;
  // поле Word (номер страницы, число страниц); res — что видно до пересчёта
  function fld(instr, res, o) {
    const f = esc(o.f || TPL.font || 'Arial');
    const rp = `<w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/>${o.b ? '<w:b/>' : ''}<w:color w:val="${o.color}"/><w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/></w:rPr>`;
    return `<w:r>${rp}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rp}<w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r>${rp}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rp}<w:t>${res}</w:t></w:r><w:r>${rp}<w:fldChar w:fldCharType="end"/></w:r>`;
  }
  // «стр. N из M» — надпись шаблона с полями номера страницы
  function pageOf(st, stNum) {
    const parts = String(T.pageOf || '{page} / {pages}').split(/(\{page\}|\{pages\})/);
    return parts.map(x => x === '{page}' ? fld('PAGE', '1', sty(stNum)) : x === '{pages}' ? fld('NUMPAGES', '1', sty(st)) : (x ? r(x, st) : '')).join('');
  }

  const HEADMARK = '\u0001KPHEAD\u0001';   // место сразу после заголовка раздела (для картинок «в начале раздела»)
  // заголовок раздела крупным шрифтом; длинное название позиции — мельче (не на полстраницы)
  function heading(title, pbb, lead) {
    const n = String(title || '').length, k = n > 110 ? 0.72 : n > 70 ? 0.84 : 1;
    let st = 'heading';
    if (k < 1) { const s = sty('heading'); st = Object.assign(s, { sz: Math.round(s.sz * k), mk: TPL.design ? 'KPS_heading' : '' }); RUNSTY = 'heading'; }
    return p(r(title, st), { after: lead ? 60 : 240, keep: true, line: 240, pbb }) + (lead ? p(r(lead, 'lead'), { after: 215, keep: true, line: 240 }) : '') + HEADMARK;
  }
  // заголовок раздела: с новой страницы или после отступа
  function headingFor(title, sec, gap, lead) {
    return sec && sec.newPage ? heading(title, !sec.fresh, lead) : (sec && sec.fresh ? '' : spacer(gap)) + heading(title, false, lead);
  }
  // подраздел: заголовок и тонкая линия на всю ширину; aside — пояснение мелким шрифтом справа в той же строке
  function subheading(title, before, after, aside) {
    return p(r(title, 'subheading') + (aside ? '<w:r><w:tab/></w:r>' + r(aside, 'subAside') : ''), { before: before == null ? 300 : before, after: after == null ? 135 : after, keep: true, rtab: aside ? W : 0,
      bdr: `<w:bottom w:val="single" w:sz="6" w:space="4" w:color="${LINE}"/>` });
  }
  const sectionOn = id => TPL.sections.some(s => s.id === id && s.on);

  const curCode = S => (S && S.cur && S.cur.code) || 'RUB';
  const curSh = S => (CURS[curCode(S)] || CURS.RUB).sh;
  const curName = S => (CURS[curCode(S)] || CURS.RUB).name;
  const cm = v => Math.round(+v * CM);
  const tw = v => Math.round(+v * 567);
  const pcsOf = q => (+q || 0) + NB + T.pcs;
  // позиция КП: сумма с опциями (цена со скидкой × количество + платные опции)
  const optsOf = it => (it.options || []).filter(o => o.name && +o.qty > 0);
  const itemSum = it => (+it.qty || 0) * netPrice(it);
  const itemTotal = it => itemSum(it) + optsOf(it).reduce((a, o) => a + (+o.qty || 0) * (o.price || 0), 0);
  const kitOf = it => (it && it.kit && Array.isArray(it.kit.parts) ? it.kit.parts : []).filter(x => x && String(x.name || '').trim());
  const kitName = x => x.name + (+x.qty > 1 ? ' × ' + x.qty : '');
  // «2 491 000,00» → крупно «2 491 000» и мельче «,00»
  const moneyParts = sum => { const s = money(sum), i = s.lastIndexOf(','); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i)]; };
  // номер позиции — синий квадрат с белой цифрой (вложенная таблица: квадрат не растягивается по высоте строки)
  function badge(n, size, st) {
    const s = size || 300;
    return tbl([[tc(p(r(String(n), st || 'badge'), { jc: 'center', line: 240 }), s, { fill: BLUE, mar: [0, 0, 0, 0], va: 'center' })]], [s], { heights: { 0: s } }) + END;
  }
  // значок условия по названию условия
  const ICONS = [[/действ/i, 'icCalendar'], [/оплат/i, 'icCard'], [/гарант/i, 'icShield'], [/доставк/i, 'icTruck'], [/монтаж|шмр|пнр|наладк/i, 'icWrench'], [/поставк|срок/i, 'icClock']];
  const iconOf = label => (ICONS.find(([re]) => re.test(label || '')) || [null, 'icNote'])[1];
  // срок действия предложения — со сроком до даты («30 дней — до 1 декабря 2026 г.»)
  const condValue = (S, c) => /действ/i.test(c.label || '') && S.validUntil && !/\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}\s*г/.test(c.value)
    ? String(c.value).replace(/[.;\s]+$/, '') + txt('condUntil', { date: ruDate(S.validUntil) }) : c.value;

  // значение для плитки — число с единицей («22 кВт», «до 10 атм», «≤ 8 бар»); текст («В кожухе») — только в таблице
  const NUMVAL = /^\s*(?:(?:до|от|не\s+более|не\s+менее|не\s+выше|не\s+ниже)\s+|[≤≥<>~±]\s*)?\d/i;
  // плитки — только полными рядами по три (одна-две — одним рядом)
  const fullRows = list => (list.length <= 3 ? list : list.slice(0, list.length - (list.length % 3)));
  // n плиток рядами не больше per, поровну: 4 → 2 + 2, 5 → 3 + 2, 7 → 3 + 2 + 2
  const evenRows = (n, per) => {
    if (!n) return [];
    const k = Math.ceil(n / per), base = Math.floor(n / k);
    return Array.from({ length: k }, (_, i) => base + (i < n % k ? 1 : 0));
  };
  // характеристики позиции для КП: без строк-«сводок» (значение из частей через «/», «;» или «,», и каждая часть — значение
  // другой строки той же позиции: «Двигатель / альтернатор: Baudouin / Evotec / Datakom» рядом со строками «Двигатель»,
  // «Альтернатор», «Контроллер») и без значений из одних знаков («/», «—»); карточка в каталоге не меняется
  function specGroups(it) {
    const groups = (it.groups || []).map(g => ({ name: g.name, rows: (g.rows || []).filter(x => x.k || x.v) }));
    const all = groups.flatMap(g => g.rows), norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
    const blank = x => x.k && String(x.v || '') !== '' && SPEC_BLANK.test(String(x.v));
    const summary = x => {
      if (!SPEC_JOINED.test(String(x.k || ''))) return false;
      const parts = String(x.v || '').split(/\s*[/;,]\s*/).map(norm).filter(Boolean);
      return parts.length > 1 && parts.every(part => all.some(y => y !== x && norm(y.v) === part));
    };
    return groups.map(g => ({ name: g.name, rows: g.rows.filter(x => !blank(x) && !summary(x)) })).filter(g => g.rows.length);
  }
  const SPEC_BLANK = /^[\s/\\|,.;:–—-]+$/, SPEC_JOINED = /[/,]|\sи\s/;
  // лист с новой страницы — пустой абзац с разрывом перед ним (в ячейке таблицы Word разрыв не делает)
  const newPage = () => p('', { pbb: true, line: 20, exact: true, mark: 2 });

  // ================================================================ ТИТУЛЬНЫЙ ЛИСТ
  // Отдельный раздел Word без полей: таблица во всю страницу. Слева — синяя колонка (сверху белое поле с логотипом):
  // вид оборудования и модель, клиент, цена, срок действия, главные условия, внизу — «Почему ПНЕВМОТЕХ» и менеджер.
  // Справа — телефоны, фото, ключевые параметры или состав предложения; внизу — получатель, «Нам доверяют», реквизиты.
  // Строки таблицы — точной высоты (титул ровно одна страница); высота текста оценивается заранее (Fit, с запасом SAFE),
  // если не помещается — по ступеням LEVELS меньше фото, список без фото и короче, без второстепенных блоков; осталось
  // место справа — фото крупнее. В строках точной высоты у ячеек нет полей сверху и снизу (отступы — абзацами): Word
  // прибавляет поле ячейки к точной высоте строки, и титул уезжал на второй лист; внизу листа — запас coverReserveCm.
  class Cover {
    constructor(S, M) {
      this.S = S; this.M = M; this.t = totals(S.items, S.vat); this.c = S.cover || {};
      this.single = S.items.length === 1;
      this.CW = tw(RULES.coverColumnCm); this.RW = PAGE.w - this.CW;
      this.LH = tw(RULES.coverLogoFieldCm);
      this.padL = 737; this.padR = 454;               // поля колонки: слева 13 мм, справа 8 мм
      this.CWi = this.CW - this.padL - this.padR;
      this.rL = 454; this.rR = 737; this.rTop = 680; this.bottom = 400;
      this.RWi = this.RW - this.rL - this.rR;
      // строки таблицы в сумме — лист без абзацев привязки и разрыва раздела (и пометки редактора) и без запаса внизу
      this.TOTAL = PAGE.h - 160 - tw(+RULES.coverReserveCm || 0);
    }
    xml() {
      Fit.k = Cover.SAFE;
      try {
        // ступени упрощения — у колонки и правой части свои; в графическом редакторе — все блоки на месте
        const pick = (levels, make) => {
          let res = null;
          for (const lv of TPL.design ? levels.slice(0, 1) : levels) { res = make(lv); if (res.fits) break; }
          return res;
        };
        const left = pick(Cover.LEFT, lv => this.leftSide(lv)), right = pick(Cover.RIGHT, lv => this.rightSide(lv));
        // титул — строки точной высоты: «не отрывать от следующего» здесь не нужно, а LibreOffice из-за него прячет абзацы
        return this.table(left, right).replace(/<w:keepNext\/>/g, '');
      } finally { Fit.k = 1; }
    }
    // колонка: под белым полем — предложение (по верхнему краю), внизу — «Почему …» и менеджер (по нижнему краю);
    // split — где начинается низ (твипы от верха листа)
    leftSide(lv) {
      const main = this.mainCol(lv), why = this.whyCol(lv), mgr = this.mgrCol(lv);
      const split = this.TOTAL - Math.max(why.h + mgr.h + this.bottom + Cover.SLACK, Cover.LOW_MIN);
      return { lv, split, fits: this.LH + Cover.MAIN_TOP + main.h + Cover.SLACK <= split, top: spacer(Cover.MAIN_TOP) + main.xml + END, low: why.xml + mgr.xml + spacer(this.bottom) };
    }
    // справа: телефоны, фото, параметры или состав предложения (по верхнему краю); внизу — получатель, «Нам доверяют»
    // и реквизиты (по нижнему краю). Осталось место — фото крупнее (до coverPhotoMaxCm), затем «Состав предложения»
    // просторнее
    rightSide(lv) {
      const low = this.lowRight(lv), req = this.requisites();
      const split = this.TOTAL - Math.max(low.h + req.h + this.bottom + Cover.SLACK, Cover.LOW_MIN);
      const free = col => split - this.rTop - Cover.SLACK - col.h, grow = {};
      let col = this.rightCol(lv, grow);
      if (free(col) > Cover.GROW_MIN && col.photo) { grow.photo = Math.floor(free(col) * Cover.GROW_USE); col = this.rightCol(lv, grow); }
      if (free(col) > Cover.GROW_MIN && !this.single) { grow.list = Math.floor(free(col) * Cover.GROW_USE); col = this.rightCol(lv, grow); }
      return { lv, split, fits: free(col) >= 0, top: spacer(this.rTop) + col.xml + END, low: low.xml + req.xml + spacer(this.bottom) };
    }
    // таблица во всю страницу: строки — по границам частей обеих сторон (белое поле, низ колонки, низ справа), часть,
    // занимающая несколько строк, — объединённой ячейкой. В строках точной высоты у ячеек нет полей сверху и снизу
    table(left, right) {
      const L = this.CW, R = this.RW, navy = { fill: NAVYD }, Lm = [0, this.padL, 0, this.padR], Rm = [0, this.rL, 0, this.rR];
      const cols = [
        [{ from: 0, to: this.LH, xml: spacer(624) + this.logo() + END, o: { va: 'top', mar: Lm } },
          { from: this.LH, to: left.split, xml: left.top, o: Object.assign({ va: 'top', mar: Lm }, navy) },
          { from: left.split, to: this.TOTAL, xml: left.low, o: Object.assign({ va: 'bottom', mar: Lm }, navy) }],
        [{ from: 0, to: right.split, xml: right.top, o: { va: 'top', mar: Rm } },
          { from: right.split, to: this.TOTAL, xml: right.low, o: { va: 'bottom', mar: Rm } }]
      ];
      const marks = [...new Set([0, this.LH, left.split, right.split, this.TOTAL])].sort((x, y) => x - y);
      const rows = [], heights = {};
      marks.slice(0, -1).forEach((top, i) => {
        heights[i] = marks[i + 1] - top;
        rows.push(cols.map((parts, c) => {
          const part = parts.find(x => x.from <= top && top < x.to), w = c ? R : L, many = part.to > marks[i + 1];
          if (part.from === top) return tc(part.xml, w, Object.assign({}, part.o, many ? { vm: 'restart' } : {}));
          return tc('', w, Object.assign({}, part.o, { vm: 'continue' }));
        }));
      });
      // синий фон колонки и за пределами таблицы — до низа листа (Word, LibreOffice: от края листа; предпросмотр — от абзаца)
      const band = anchorPara(rect(L, PAGE.h - this.LH, NAVYD, { page: true, x: 0, y: this.LH, dx: 0, dy: this.LH }));
      return band + tbl(rows, [L, R], { heights });
    }
    // логотип в фирменных цветах на белом поле над колонкой
    logo() {
      const g = this.M.assets && this.M.assets.coverLogo;
      if (!g) return p(brandRuns('coverClient'), { line: 240 });
      const cy = tw(RULES.coverLogoHeightCm) * E, cx = Math.min(Math.round(cy * g.w / g.h), this.CWi * E + 280 * E);
      return p(img(g.rid, cx, Math.round(cx * g.h / g.w), 'Логотип', 'coverLogoHeightCm'), { line: 240 });
    }
    // колонка: надзаголовок, вид и модель (одна позиция) или вид оборудования, клиент, цена, срок, главные условия
    mainCol(lv) {
      const S = this.S, c = this.c, t = this.t, w = this.CWi, out = [];
      let h = 0;
      const add = (x, hh) => { out.push(x); h += hh; };
      add(p(r(T.coverKicker, 'coverKicker'), { after: 110, line: 240 }), Fit.h(T.coverKicker, w, 'coverKicker', 240, 0, 110));
      const bigTx = this.single ? (c.model || c.title || '') : (c.title || T.coverKicker);
      // длинное название — мельше, чтобы не занимало полколонки
      const big = sty('coverModel'), k = (bigTx.length > 48 ? 0.7 : bigTx.length > 30 ? 0.82 : 1) * (lv.smallTitle ? 0.85 : 1);
      const bigSt = k < 1 ? Object.assign({}, big, { sz: Math.round(big.sz * k), mk: TPL.design ? 'KPS_coverModel' : '' }) : 'coverModel';
      if (this.single && c.title && c.model) add(p(r(c.title, 'coverTitle'), { after: 60, line: 240 }), Fit.h(c.title, w, 'coverTitle', 240, 0, 60));
      add(p(bigTx.length <= 22 ? Typo.solid(bigTx, bigSt) : r(bigTx, bigSt), { line: 228 }), Fit.h(bigTx, w, typeof bigSt === 'string' ? bigSt : big, 228));
      if (!this.single && c.model && c.model !== c.title && !lv.noSub) add(p(r(c.model, 'coverSub'), { before: 80, line: 240 }), Fit.h(c.model, w, 'coverSub', 240, 80));
      add(p('', { before: 0, after: 215, indR: Math.max(0, w - 907), bdr: line('bottom', 20, SKY), line: 240, mark: 12 }), 455);
      if (S.client) { const cl = txt('coverFor', { client: Typo.org(S.client) }); add(p(r(cl, 'coverClient'), { line: 240 }), Fit.h(cl, w, 'coverClient', 240)); }
      // цена: «Стоимость с НДС» — сумма крупно (копейки мельче) — скидка — срок действия
      const [whole, kop] = moneyParts(t.sum);
      add(p(r(txt('priceWithVat', { vat: S.vat }), 'navyLabel'), { before: lv.tight ? 300 : 425, after: 60, line: 240, bdr: line('top', 6, NAVYLINE, 8) }), (lv.tight ? 300 : 425) + 400);
      add(p(r(whole, 'coverSum') + r(kop + NB + curSh(S), 'coverSumSmall'), { line: 240 }), Fit.h(whole + kop, w, 'coverSum', 240));
      if (BLK.discount && t.discount > 0) { const d = txt('coverDiscount', { sum: money(t.discount), cur: curSh(S) }); add(p(r(d, 'navyNote'), { before: 40, line: 240 }), Fit.h(d, w, 'navyNote', 240, 40)); }
      if (S.validUntil) {
        const v = txt('validUntil', { date: ruDate(S.validUntil) }), vw = Math.min(w, Fit.width(v, 'coverBadge') + 300);
        add(spacer(150) + tbl([[tc(p(r(v, 'coverBadge'), { line: 240 }), vw, { bdr: B([6, SKY], [6, SKY], [6, SKY], [6, SKY]), mar: [45, 130, 55, 130] })]], [vw]) + END, 150 + 330);
      }
      // предложение и главные условия — строками с тонкой линией
      if (BLK.coverTerms) {
        const facts = [[T.offerRef, txt('offerNo', { number: S.number || '—', date: ruDate(S.date) })]];
        const terms = (S.conditions || []).filter(x => x.value && !/действ/i.test(x.label || '')).slice(0, Math.max(0, +RULES.coverTermsMax || 0) - (lv.fewTerms || 0));
        terms.forEach(x => facts.push([x.label, Cover.lead(x)]));
        facts.forEach(([k, v], i) => {
          add(p(r(k, 'navyLabel'), { before: i ? 100 : (lv.tight ? 300 : 340), after: 25, line: 240, keep: true, bdr: line('top', 6, NAVYLINE, 5) }), (i ? 100 : 340) + 230);
          add(Typo.paras(v, 'navyText', { line: 252 }), Fit.h(v, w, 'navyText', 252));
        });
      }
      return { xml: out.join(''), h };
    }
    // низ колонки: «Почему ПНЕВМОТЕХ» — преимущества точками
    whyCol(lv) {
      const w = this.CWi, out = [];
      let h = 0;
      const AD = BLK.coverWhy && !lv.noWhy ? (TPL.advantages || []).slice(0, RULES.advantagesMax) : [];
      if (!AD.length) return { xml: END, h: 0 };
      out.push(p(r(T.whyTitle, 'navyLabel'), { after: 40, line: 240, keep: true })); h += 200;
      AD.forEach(([ti, tx]) => {
        const body = lv.shortWhy ? '' : ' ' + tx;
        out.push(p(marker('•', { sz: 16, color: SKY }) + r(ti + '.', 'whyHead') + r(body, 'whyText'), { before: 70, line: 252, indL: 204, hang: 204, tab0: true }));
        h += 70 + Fit.h(ti + '.' + body, w - 204, 'whyText', 252);
      });
      return { xml: out.join(''), h };
    }
    // самый низ колонки: ваш менеджер — имя, должность, телефоны, почта
    mgrCol(lv) {
      const w = this.CWi, out = [], m = this.S.manager || {};
      let h = 0;
      const add = (x, hh) => { out.push(x); h += hh; };
      if (!BLK.coverManager || !m.name) return { xml: END, h: 0 };
      const rule = BLK.coverWhy && !lv.noWhy && (TPL.advantages || []).length && RULES.advantagesMax > 0;
      add(p(r(T.managerTitle, 'navyLabel'), { before: rule ? 280 : 0, after: 40, line: 240, keep: true, bdr: rule ? line('top', 6, NAVYLINE, 8) : '' }), (rule ? 440 : 0) + 200);
      add(p(r(m.name, 'coverManager'), { after: 20, line: 240 }), Fit.h(m.name, w, 'coverManager', 240, 0, 20));
      if (m.position) add(p(r(m.position, 'coverManagerPost'), { after: 30, line: 252 }), Fit.h(m.position, w, 'coverManagerPost', 252, 0, 30));
      const lines = [];
      if (m.phone) lines.push(Typo.solid(m.phone, 'coverManagerText') + (m.ext ? r(txt('ext', { ext: m.ext }), 'coverManagerPost') : ''));
      if (m.mobile) lines.push(r(String(T.mobileShort || '').split('{phone}')[0], 'coverManagerText') + Typo.solid(m.mobile, 'coverManagerText'));
      if (m.email) lines.push(r(m.email, Object.assign(sty('coverManagerText'), { solid: true })));
      lines.forEach(x => add(p(x, { line: 276 }), 290));
      return { xml: out.join(''), h };
    }
    // справа: телефоны, фото, ключевые параметры (одна позиция) или состав предложения; grow — прибавка к высоте фото
    // (photo) и списка (list), твипы
    rightCol(lv, grow) {
      const S = this.S, w = this.RWi, out = [];
      let h = 0;
      const add = (x, hh) => { out.push(x); h += hh; };
      if (T.coverPhones || TPL.site) {
        const ph = String(T.coverPhones || '').split(/\s*·\s*/).filter(Boolean);
        const runs = ph.map(x => Typo.solid(x, 'coverPhone')).join(r(' · ', 'coverSite'));
        add((runs ? p(runs, { jc: 'right', line: 240 }) : '') + (TPL.site ? p(r(TPL.site, Object.assign(sty('coverSite'), { solid: true })), { jc: 'right', before: 40, line: 240 }) : ''), 480);
      }
      const photo = BLK.coverPhoto && lv.photo > 0 ? this.photo(lv, grow.photo) : null;
      if (photo) add(spacer(280) + photo.xml, 280 + photo.h);
      if (this.single) this.one(lv, add); else this.list(lv, add, grow.list || 0);
      return { xml: out.join(''), h, photo: !!photo };
    }
    // справа внизу, над реквизитами: получатель, вниманию, объект и «Нам доверяют»
    lowRight(lv) {
      const out = [];
      let h = 0;
      if (BLK.coverRecipient) { const who = this.who(); if (who.h) { out.push(who.xml); h += who.h; } }
      if (BLK.coverTrust && TPL.trust && !lv.noTrust) {
        const tx = T.trustLabel + '   ' + TPL.trust, before = h ? 260 : 0;
        out.push(p(r(T.trustLabel, 'label') + r('   ', 'trustText') + r(TPL.trust, 'trustText'), { before, line: 264 }));
        h += Fit.h(tx, this.RWi, 'trustText', 264, before);
      }
      if (h) { out.push(spacer(300)); h += 300; }
      return { xml: out.join(''), h };
    }
    // фото титула — плитка позиции (рамка уже на картинке) или фото без рамки
    photo(lv, grow) {
      const S = this.S, M = this.M, items = M.items || {};
      const pick = [S.cover && S.cover.photoFrom, ...S.items.map(it => it.id)].find(id => id && items[id] && items[id].tile);
      const g = pick ? items[pick].tile : M.cover;
      if (!g) return null;
      const base = tw(this.single ? RULES.coverPhotoHeightCm : RULES.coverPhotoMultiCm) * lv.photo;
      const maxH = Math.max(base, Math.min(base + (grow || 0), tw(+RULES.coverPhotoMaxCm || 0)));
      const k = Math.min(this.RWi / g.w, maxH / g.h), cx = Math.round(g.w * k), cy = Math.round(g.h * k);
      const pic = p(img(g.rid, cx * E, cy * E, 'Оборудование', 'coverPhotoWidthCm'), { jc: 'center', line: 240 });
      if (pick) return { xml: pic, h: cy + 60 };
      return { xml: tbl([[tc(pic, this.RWi, { bdr: B(FRAME, FRAME, FRAME, FRAME), mar: [100, 100, 100, 100] })]], [this.RWi]) + END, h: cy + 260 };
    }
    // одна позиция: ключевые параметры плитками по три, описание, «В предложение также входит»
    one(lv, add) {
      const S = this.S, c = this.c, w = this.RWi, it = S.items[0];
      const kp = BLK.coverKpis ? fullRows((c.kpis || []).filter(k => NUMVAL.test(String(k.num || ''))).slice(0, lv.kpis || 6)) : [];
      if (kp.length) {
        const per = Math.min(3, kp.length), cw = Math.floor(w / per), ws = Array.from({ length: per }, (_, i) => i === per - 1 ? w - cw * (per - 1) : cw), rows = [];
        let hh = 0;
        for (let i = 0; i < kp.length; i += per) {
          const rowH = Math.max(...kp.slice(i, i + per).map(k => Fit.h(k.num + ' ' + (k.unit || ''), cw - 200, 'kpiValue', 240, 0, 30) + Fit.h(k.cap || ' ', cw - 200, 'kpiCaption', 240)));
          hh += rowH + 290;
          rows.push(ws.map((wj, j) => {
            const k = kp[i + j], top = i === 0 ? [6, LINE] : null, bottom = [4, HAIR];
            if (!k) return tc(END, wj, { bdr: B(top, null, bottom), mar: [0, 0, 0, 0] });
            return tc(p(r(k.num, 'kpiValue') + (k.unit ? r(' ' + k.unit, 'kpiUnit') : ''), { after: 30, line: 240 }) + p(r(k.cap || '', 'kpiCaption'), { line: 240 }), wj,
              { bdr: B(top, j ? [4, HAIR] : null, bottom), va: 'top', mar: [145, j ? 170 : 0, 150, 100] });
          }));
        }
        add(spacer(280) + tbl(rows, ws), 280 + hh);
      }
      if (BLK.coverDesc && c.desc && !lv.noDesc) add(p(r(c.desc, 'coverDesc'), { before: 225, line: 276, hy: true }), Fit.h(c.desc, w, 'coverDesc', 276, 225));
      if (!BLK.coverIncluded || lv.noIncluded) return;
      const opts = optsOf(it).slice(0, Math.max(0, +RULES.coverOptionsMax || 0)), parts = kitOf(it);
      if (!opts.length && !parts.length) return;
      add(p(r(T.coverIncluded, 'label'), { before: 200, after: 40, line: 240, keep: true }), 290);
      opts.forEach(o => {
        const price = o.price ? money((+o.qty || 0) * o.price) + NB + curSh(this.S) : T.coverIncludedFree;
        add(p(marker('+', sty('coverOption', { color: GRAY, b: true })) + r(o.short || o.name, 'coverOption') + r(' — ' + price, sty('coverOption', { color: GRAY })),
          { after: 20, line: 252, indL: 215, hang: 215, tab0: true }), Fit.h(o.name + ' — ' + price, w - 215, 'coverOption', 252, 0, 20));
      });
      if (parts.length) {
        const tx = txt('coverParts', { list: parts.map(kitName).join(', ') });
        add(p(r(tx, 'coverOption'), { before: opts.length ? 60 : 0, line: 252, hy: true }), Fit.h(tx, w, 'coverOption', 252, 60));
      }
    }
    // несколько позиций: «Состав предложения» — номер, фото, название и строка характеристик, сумма; итог.
    // extra — свободное место (твипы): миниатюры крупнее (до LIST_THUMB), строки просторнее (до LIST_PAD)
    list(lv, add, extra) {
      const S = this.S, w = this.RWi, items = S.items, M = this.M.items || {};
      if (!BLK.coverList) return;
      const compact = items.length >= RULES.coverCompactFrom || lv.compact || !items.some(it => (M[it.id] || {}).tile);
      const max = Math.max(2, +RULES.coverListMax || 10) - (lv.listCut || 0);
      const shown = items.length > max ? items.slice(0, max - 1) : items;
      add(p(r(T.coverListTitle, 'subheading') + '<w:r><w:tab/></w:r>' + r(txt('coverListSum', { cur: curSh(S) }), 'subAside'),
        { before: 300, after: 40, line: 240, keep: true, rtab: w, bdr: '' }), 440);
      const per = Math.floor((extra || 0) / Math.max(1, shown.length));
      const th = compact ? 0 : Math.min(Cover.LIST_THUMB, 640 + Math.floor(per * 0.6)), tw0 = Math.round(964 * th / 640);
      const wn = 397, wt = compact ? 0 : tw0 + 147, ws = 1400, wx = w - wn - wt - ws;
      const ws2 = compact ? [wn, wx, ws] : [wn, wt, wx, ws];
      const pad0 = compact ? 76 : 142, pad = pad0 + Math.min(Cover.LIST_PAD, Math.max(0, Math.floor((per - (th ? th - 640 : 0)) / 2))), rows = [];
      let hh = 0;
      shown.forEach((it, i) => {
        const bd = B(null, null, [4, HAIR]);
        const spec = [pcsOf(it.qty), Typo.short(it.spec, Cover.SPEC_MAX)].filter(Boolean).join(' · ');
        const name = p(r(it.name, 'listName'), { line: 236 }) + (spec ? p(r(spec, 'listSpec'), { before: 10, line: 236 }) : '');
        const tile = (M[it.id] || {}).tile;
        const nameH = Fit.h(it.name, wx - 100, 'listName', 236) + (spec ? Fit.h(spec, wx - 100, 'listSpec', 236, 10) : 0);
        const rowH = Math.max(nameH, compact ? 300 : th - 40) + 2 * pad;
        hh += rowH;
        const cells = [tc(badge(i + 1), wn, { bdr: bd, va: 'center', mar: [pad, 0, pad, 0] })];
        if (!compact) {
          const pic = tile ? (() => { const k = Math.min(tw0 / tile.w, th / tile.h); return p(img(tile.rid, Math.round(tile.w * k) * E, Math.round(tile.h * k) * E, it.name), { line: 240 }); })() : END;
          cells.push(tc(pic, wt, { bdr: bd, va: 'center', mar: [pad, 0, pad, 147] }));
        }
        cells.push(tc(name, wx, { bdr: bd, va: 'center', mar: [pad, 0, pad, 100] }), tc(p(r(money(itemTotal(it)), 'listSum'), { jc: 'right', line: 240 }), ws, { bdr: bd, va: 'center', mar: [pad, 0, pad, 0] }));
        rows.push(cells);
      });
      const n = ws2.length;
      if (shown.length < items.length) {
        const rest = items.length - shown.length;
        const more = txt('coverListMore', { n: rest + NB + plural(rest, 'позиция', 'позиции', 'позиций'), offer: T.offerTitle });
        rows.push([tc('', ws2[0], { mar: [70, 0, 70, 0] }), tc(p(r(more, 'listSpec'), { line: 240 }), ws2.slice(1, n - 1).reduce((a, b) => a + b, 0), { span: n - 2, mar: [70, 0, 70, 0] }),
          tc('', ws2[n - 1], { mar: [70, 0, 70, 0] })]);
        hh += 300;
      }
      const tot = txt('coverListTotal', { vat: S.vat });
      rows.push([tc(p(r(tot, 'listTotal'), { line: 240 }), ws2.slice(0, n - 1).reduce((a, b) => a + b, 0), { span: n - 1, bdr: B([10, DARK]), mar: [125, 0, 0, 0] }),
        tc(p(r(money(this.t.sum), 'listTotalSum'), { jc: 'right', line: 240 }), ws2[n - 1], { bdr: B([10, DARK]), mar: [125, 0, 0, 0] })]);
      hh += 420;
      add(tbl(rows, ws2), hh);
    }
    // получатель, вниманию, объект — строками с тонкой линией
    who() {
      const S = this.S, ct = S.contact || {}, ob = S.object || {}, w = this.RWi, wl = 1417, wr = w - wl, rows = [];
      let h = 0;
      const row = (label, runs, tx) => {
        rows.push([tc(p(r(label, 'label'), { line: 240 }), wl, { bdr: B([4, HAIR]), va: 'top', mar: [115, 0, 105, 0] }),
          tc(p(runs, { line: 252 }), wr, { bdr: B([4, HAIR]), va: 'top', mar: [100, 0, 105, 0] })]);
        h += 220 + Fit.h(tx, wr, 'whoText', 252);
      };
      const client = Typo.org(S.client);
      if (client) row(T.recipient, r(client, 'whoValue') + (S.clientInn ? r('  ' + txt('inn', { inn: S.clientInn }), 'whoSub') : ''), client + ' ' + (S.clientInn || ''));
      if (ct.name) row(T.attention, r(ct.name, 'whoText') + (ct.post ? r('  ' + ct.post, 'whoSub') : ''), ct.name + ' ' + (ct.post || ''));
      const place = [ob.purpose, ob.address].filter(Boolean).join(', ');
      if (place) row(T.object, r(place, 'whoText'), place);
      return { xml: rows.length ? tbl(rows, [wl, wr]) : '', h };
    }
    // срок поставки на титуле — коротко, по самой долгой позиции («под заказ, до 80 рабочих дней»); сроки по позициям —
    // в «Условиях поставки». Условие из одной части или нераспознанное — как есть
    static lead(cond) {
      const value = String(cond.value || '');
      if (!/срок|поставк/i.test(cond.label || '') || value.indexOf(';') < 0) return value;
      let best = null, order = false;
      for (const part of value.split(';').map(s => s.trim()).filter(Boolean)) {
        const tail = part.split(/\s[—–]\s/).pop(), m = Cover.LEAD.exec(tail);
        if (/под\s+заказ/i.test(tail)) order = true;
        if (!m) { if (Cover.STOCK.test(tail)) continue; return value; }
        const days = +(m[2] || m[1]) * Cover.leadDays(m);
        if (!best || days > best.days) best = { days, text: m[0].replace(/^\d+\s*[–—-]\s*/, '') };
      }
      return best ? txt(order ? 'coverLeadOrder' : 'coverLeadUpTo', { lead: best.text }) : value;
    }
    // единица срока — в календарных днях (для сравнения сроков разных позиций)
    static leadDays(m) {
      const unit = m[4].toLowerCase();
      if (unit.startsWith('мес')) return Cover.DAYS.month;
      if (unit.startsWith('недел')) return Cover.DAYS.week;
      return /рабоч|банковск/i.test(m[3] || '') ? Cover.DAYS.work : 1;
    }
    // реквизиты и номер страницы — внизу справа
    requisites() {
      if (!BLK.coverRequisites || !T.coverRequisites) return { xml: END, h: 0 };
      const w = this.RWi, wp = 1250, wq = w - wp, bd = B([8, BLUE]);
      const xml = tbl([[tc(p(r(T.coverRequisites, 'requisites'), { line: 252 }), wq, { bdr: bd, va: 'top', mar: [110, 0, 0, 200] }),
        tc(p(pageOf('requisites', 'requisites'), { jc: 'right', line: 252 }), wp, { bdr: bd, va: 'top', mar: [110, 0, 0, 0] })]], [wq, wp]) + END;
      return { xml, h: 110 + Fit.h(T.coverRequisites, wq - 200, 'requisites', 252) };
    }
  }
  Cover.SPEC_MAX = 90;   // строка характеристик позиции в «Составе предложения» — не длиннее (знаков), дальше «…»
  Cover.SAFE = 1.1;      // запас к оценке высоты текста на титуле: Word и LibreOffice ставят строки по-разному
  Cover.GROW_MIN = 300;  // свободнее этого (твипы) справа — фото крупнее, затем список просторнее
  Cover.SLACK = 120;     // зазор под верхней частью и над нижней (твипы)
  Cover.MAIN_TOP = 510;  // отступ колонки под белым полем
  Cover.LOW_MIN = 900;   // низ колонки и низ справа — не ниже (твипы)
  Cover.GROW_USE = 0.9;  // какую долю свободного места занимать
  Cover.LIST_THUMB = 1080;  // миниатюра в «Составе предложения» — не выше (твипы)
  Cover.LIST_PAD = 110;     // прибавка к полям строки списка — не больше (твипы)
  // срок поставки позиции: число (или «6–8»), вид дней и единица
  Cover.LEAD = /(\d+)(?:\s*[–—-]\s*(\d+))?\s*(?:(рабоч|календарн|банковск)\S*\s+)?(дн|дня|день|недел|мес)\S*/i;
  Cover.STOCK = /налич|склад/i;  // «в наличии», «со склада» — срок не дольше остальных
  Cover.DAYS = { month: 30, week: 7, work: 7 / 5 };
  // ступени упрощения, если не помещается: у колонки — плотнее, заголовок мельче, «Почему …» короче, меньше условий,
  // без «Почему …»; справа — меньше фото, без «Нам доверяют», список без фото и короче, без описания и опций
  Cover.LEFT = [
    {}, { tight: true }, { tight: true, smallTitle: true }, { tight: true, smallTitle: true, shortWhy: true },
    { tight: true, smallTitle: true, shortWhy: true, fewTerms: 1 }, { tight: true, smallTitle: true, noWhy: true, fewTerms: 1 },
    { tight: true, smallTitle: true, noWhy: true, fewTerms: 2, noSub: true }
  ];
  Cover.RIGHT = [
    { photo: 1 }, { photo: 0.85 }, { photo: 0.72 }, { photo: 0.6, noTrust: true }, { photo: 0.5, noTrust: true, compact: true },
    { photo: 0.45, noTrust: true, compact: true, noDesc: true, kpis: 3 }, { photo: 0.4, noTrust: true, compact: true, noDesc: true, kpis: 3, listCut: 2 },
    { photo: 0, noTrust: true, compact: true, noDesc: true, kpis: 3, listCut: 4, noIncluded: true }
  ];
  // титул — отдельный раздел без полей и колонтитулов (номер страницы — в самом титуле)
  function coverXml(S, M) {
    const sect = `<w:sectPr><w:pgSz w:w="${PAGE.w}" w:h="${PAGE.h}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>`;
    return new Cover(S, M).xml() + COVEREND + `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>${sect}</w:pPr></w:p>`;
  }
  const COVEREND = '\u0001KPCOVEREND\u0001';

  // ================================================================ СТОИМОСТЬ И УСЛОВИЯ
  // Карточка на позицию: номер, фото, название и характеристики, «кол-во × цена» со скидкой, сумма; под ней — опции
  // с итогом по позиции или состав изделия строкой. Карточка не разрывается; последняя держится с итогом.
  // Итог к оплате — светлая плашка с синей полосой слева: сумма прописью, без скидки и скидка, НДС.
  function offerXml(S, sec, M) {
    const t = totals(S.items, S.vat), cur = curSh(S);
    const lead = txt('offerLead', { curName: curName(S), vat: S.vat }) + (S.validUntil ? txt('offerLeadUntil', { date: ruDate(S.validUntil) }) : '');
    const out = [headingFor(T.offerTitle, sec, 480, lead)];
    const showD = BLK.discount && t.discount > 0;
    const PAD = 181, CWI = W - 2 * PAD;
    const wn = 300, g1 = 181, wt = 907, g2 = 181, wq = 1000, wsum = 2400;
    const wname = CWI - wn - g1 - wt - g2 - wsum;
    const grid = [wn, g1, wt, g2, wname - wq, wq, wsum];
    const ind = wn + g1 + wt + g2;
    const items = S.items, mi = M.items || {};
    items.forEach((it, i) => {
      const unit = showD ? it.price : netPrice(it), d = showD ? unitDisc(it) : 0;
      const chip = d ? r(NB + (it.disc.type === 'sum' ? '−' + money(d) : '−' + String(it.disc.v).replace('.', ',') + NB + '%') + NB, Object.assign(sty('chip'), { shd: BLUE })) : '';
      const calc = p(r(txt('unitPrice', { qty: pcsOf(it.qty), price: money(unit) }), 'cardCalc') + (chip ? r(NB, 'cardCalc') + chip : ''), { jc: 'right', line: 240 });
      const price = calc + p(r(money(itemSum(it)), 'cardSum'), { jc: 'right', before: 20, line: 240 });
      const tile = (mi[it.id] || {}).tile;
      const pic = tile ? (() => { const k = Math.min(wt / tile.w, 652 / tile.h); return p(img(tile.rid, Math.round(tile.w * k) * E, Math.round(tile.h * k) * E, it.name), { line: 240 }); })() : END;
      const name = p(r(it.name, 'cardName'), { line: 240 }) + (it.spec ? p(r(it.spec, 'cardSpec'), { before: 20, line: 240, hy: true }) : '');
      const Z = [0, 0, 0, 0];
      // без фото — название сразу после номера (колонка миниатюры не пустует)
      const head = tile
        ? [tc(END, g1, { mar: Z }), tc(pic, wt, { mar: Z, va: 'center' }), tc(END, g2, { mar: Z }), tc(name, wname, { span: 2, mar: [0, 0, 0, 120], va: 'center' })]
        : [tc(END, g1, { mar: Z }), tc(name, wt + g2 + wname, { span: 4, mar: [0, 0, 0, 120], va: 'center' })];
      const rows = [[tc(badge(i + 1), wn, { mar: Z, va: 'center' })].concat(head, [tc(price, wsum, { mar: Z, va: 'center' })])];
      const opts = optsOf(it), parts = BLK.offerKit ? kitOf(it) : [];
      const lineCells = (first, a, b, c, st) => [tc('', ind, { span: 4, mar: Z }),
        tc(p(a, { line: 240 }), wname - wq, { bdr: first ? B([4, HAIR]) : B(), mar: [first ? 60 : 10, 0, 10, 0] }),
        tc(p(b, { jc: 'right', line: 240 }), wq, { bdr: first ? B([4, HAIR]) : B(), mar: [first ? 60 : 10, 0, 10, 0] }),
        tc(p(c, { jc: 'right', line: 240 }), wsum, { bdr: first ? B([4, HAIR]) : B(), mar: [first ? 60 : 10, 0, 10, 0] })];
      opts.forEach((o, j) => {
        const sum = o.price ? r(money((+o.qty || 0) * o.price), 'cardLine') : r(T.included, 'cardLineMuted');
        rows.push(lineCells(j === 0, r('+', sty('cardLineMuted', { b: true })) + r(NB + NB + (o.name), 'cardLine'), r((+o.qty || 0) + NB + (o.unit || T.pcs), 'cardLineMuted'), sum));
      });
      if (opts.length) rows.push([tc('', ind, { span: 4, mar: Z }), tc(p(r(txt('positionTotal', { n: i + 1 }), 'cardSub'), { line: 240 }), wname, { span: 2, bdr: B([4, HAIR]), mar: [70, 0, 0, 0] }),
        tc(p(r(money(itemTotal(it)), 'cardSub'), { jc: 'right', line: 240 }), wsum, { bdr: B([4, HAIR]), mar: [70, 0, 0, 0] })]);
      if (parts.length) {
        // состав одного изделия — как на титуле и в «Составе изделия» (количество позиции — в строке цены)
        const list = parts.map(kitName).join(', ');
        rows.push([tc('', ind, { span: 4, mar: Z }), tc(p(r(T.kitInOffer, 'cardPartsHead') + r(list, 'cardParts'), { line: 252, hy: true }), wname + wsum, { span: 3, bdr: B([4, HAIR]), mar: [70, 0, 0, 0] })]);
      }
      const inner = tbl(rows, grid, { split: true }) + END;
      const card = tbl([[tc(inner, W, { bdr: B([6, LINE], [6, LINE], [6, LINE], [6, LINE]), mar: [113, PAD, 100, PAD], va: 'top' })]], [W]);
      out.push((i ? spacer(125) : '') + (i === items.length - 1 ? keepAll(card) : card));
    });
    // итог к оплате
    const words1 = BLK.amountInWords ? Typo.cap(words(t.sum, curCode(S))) : '';
    const sub = showD ? txt('subtotalLine', { gross: money(t.gross), discount: money(t.discount) }) : '';
    const left = p(r(T.grandTotal, 'totalTitle'), { after: 30, line: 240 }) + (sub ? p(r(sub, 'totalNote'), { line: 252 }) : '') + (words1 ? p(r(words1, 'totalNote'), { line: 252 }) : '');
    const right = p(r(money(t.sum) + NB + cur, 'totalSum'), { jc: 'right', line: 240 }) + p(r(txt('vatIncl', { vat: S.vat, vatSum: money(t.vat) }), 'totalNote'), { jc: 'right', before: 30, line: 240 });
    // светлая плашка — одной ячейкой (без шва между частями), внутри — итог слева и сумма справа
    const wb = 91, wp = W - wb, wr = 3800, wl = wp - 500 - wr;
    const inner = tbl([[tc(left, wl, { mar: NOM, va: 'center' }), tc(right, wr, { mar: [0, 120, 0, 0], va: 'center' })]], [wl, wr]) + END;
    out.push(spacer(60) + tbl([[tc(END, wb, { fill: BLUE, mar: [0, 0, 0, 0] }), tc(inner, wp, { fill: LIGHT, mar: [150, 250, 150, 250], va: 'center' })]], [wb, wp]));
    const C = CURS[curCode(S)], rt = S.cur && +S.cur.rate;
    const note = curCode(S) !== 'RUB' && BLK.currencyNote ? txt('currencyNote', { curName: C.name }) +
      (rt ? txt(S.cur.own ? 'currencyRateOwn' : 'currencyRate', { rateDate: S.cur.date ? ' на ' + ruDate(S.cur.date) : '', cur: C.sh, rate: String(rt).replace('.', ','), rub: money(Math.round(t.sum * rt)) }) : '') : '';
    if (note) out.push(p(r(note, 'note'), { before: 100, line: 252, hy: true }));
    return out.join('');
  }

  // ================================================================ УСЛОВИЯ ПОСТАВКИ
  // Плитки: значок слева, название условия и значение. Короткие — рядами по три, поровну (два — пополам, четыре — по два),
  // длинное (длиннее condLongChars) — во всю ширину, сроки по позициям — строками; текст без переносов слов (названия
  // моделей не рвутся). Ниже — «Дополнительно: …». Заголовок, плитки и «Дополнительно» — одной неразрывной строкой-
  // контейнером: блок не делится между листами ни в Word, ни в LibreOffice
  function conditionsXml(S, sec, M) {
    const conds = (S.conditions || []).filter(c => c.value);
    const extra = String(S.condExtra || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!conds.length && !extra.length) return '';
    const lines = [];
    let run = [];
    const flush = () => { for (const k of evenRows(run.length, Cond.PER)) lines.push(run.splice(0, k)); };
    conds.forEach(c => { if (String(condValue(S, c)).length > +RULES.condLongChars) { flush(); lines.push([c]); } else run.push(c); });
    flush();
    let block = lines.map((line, i) => (i ? spacer(Cond.GAP) : '') + Cond.row(S, line, M.assets || {})).join('');
    if (extra.length) {
      if (extra.length === 1) block += p(r(T.condExtraTitle + ' ', 'extraLabel') + r(extra[0], 'extraText'), { before: 160, line: 264, hy: true });
      else block += p(r(T.condExtraTitle, 'extraLabel'), { before: 160, after: 40 }) + Typo.paras(extra.join('\n'), 'extraText', { line: 264, gap: 40, hy: true });
    }
    const head = sec && sec.newPage ? heading(T.conditionsTitle, false) : subheading(T.conditionsTitle, 0) + HEADMARK;
    const lead = sec && sec.fresh ? '' : sec && sec.newPage ? newPage() : spacer(340);
    return lead + keepBlock(head + block);
  }
  class Cond {
    // ряд плиток во всю ширину
    static row(S, line, A) {
      const per = line.length, ic = Cond.ICON, icG = Cond.ICON_GAP, tileW = Math.floor((W - Cond.GAP * (per - 1)) / per), cells = [], ws = [];
      line.forEach((c, j) => {
        const wTile = j === per - 1 ? W - (tileW + Cond.GAP) * (per - 1) : tileW;
        if (j) { cells.push(gapCell(Cond.GAP)); ws.push(Cond.GAP); }
        const g = A[iconOf(c.label)], val = Cond.text(condValue(S, c), per);
        const icon = g ? p(img(g.rid, ic * E, Math.round(ic * g.h / g.w) * E, c.label), { line: 240 }) : END;
        cells.push(tc(icon, ic + icG, { bdr: B(FRAME, FRAME, FRAME, null), va: 'top', mar: [113, 136, 100, 0] }),
          tc(p(r(c.label, 'label'), { after: 25, line: 240 }) + Typo.paras(val, 'condText', { line: 252 }), wTile - ic - icG,
            { bdr: B(FRAME, null, FRAME, FRAME), va: 'top', mar: [113, 0, 100, 136] }));
        ws.push(ic + icG, wTile - ic - icG);
      });
      return tbl([cells], ws);
    }
    // во всю ширину сроки по позициям («Модель — под заказ, 16 рабочих дней; …») — каждый своей строкой
    static text(val, per) {
      const parts = String(val || '').split(/;\s*/).map(s => s.trim()).filter(Boolean);
      return per === 1 && parts.length > 1 && parts.every(s => /\s[—–]\s/.test(s)) ? parts.join('\n') : val;
    }
  }
  Cond.PER = 3;            // плиток в ряду — не больше
  Cond.GAP = 136;          // между плитками и рядами
  Cond.ICON = 368;         // значок условия
  Cond.ICON_GAP = 261;     // поле вокруг значка

  // ================================================================ СТРАНИЦА ОБОРУДОВАНИЯ
  // Страница позиции: строка-заголовок (номер, «Позиция N из M», название, количество и сумма), первый экран
  // (фото + ключевые параметры + коротко о главном), узлы и компоненты, особенности списком «подзаголовок — текст»,
  // характеристики карточками групп (в две колонки, если строк много), фото и схемы. Небольшие позиции — Card.
  // шапка таблицы — светлой заливкой: повторяется на каждой странице длинной таблицы
  const HDR = (t, w, jc = 'left', span = 1) => tc(p(r(t, 'tableHeader'), { jc, keep: true, line: 240 }), w, { fill: LIGHT, bdr: B(null, null, [6, LINE]), mar: [90, 120, 90, 120], span });
  const PXCAP = 914400 / 150;   // EMU на пиксель при 150 dpi — мелкие картинки не растягиваются
  // «не отрывать»: все абзацы строк таблицы держатся со следующими — Word переносит такой блок целиком
  const keepAll = xml => xml.replace(/<w:pPr>(?!<w:keepNext\/>)/g, '<w:pPr><w:keepNext/>').replace(/<w:p>(?!<w:pPr>)/g, '<w:p><w:pPr><w:keepNext/></w:pPr>');
  const keepRow = row => row.map(keepAll);
  // строки таблицы: заголовок держится с первыми specKeepRows строками, последние две — вместе; остальное переносится
  // на следующий лист (строка с названием группы там повторяется) — таблица не уходит на новый лист целиком
  const keepTail = (i, n) => i < n - 1 && (i < Math.max(1, +RULES.specKeepRows || 0) - 1 || i >= n - 2);
  const specVal = row => row.hl ? 'specValueKey' : 'specValue';
  const fit = (g, bw, bh) => { const k = Math.min(bw / g.w, bh / g.h, PXCAP); return [Math.round(g.w * k), Math.round(g.h * k)]; };
  const NOM = [0, 0, 0, 0];
  const gapCell = w => tc(END, w, { mar: NOM });
  // блок, который не делится между листами: одна строка-контейнер во всю ширину — Word и LibreOffice переносят её на
  // следующий лист целиком («не отрывать от следующего» между таблицами LibreOffice не выполняет)
  const keepBlock = xml => tbl([[tc(xml + END, W, { va: 'top', mar: NOM })]], [W]);

  // строка-заголовок позиции: номер, «Позиция N из M», название; справа — количество и сумма с опциями
  function posHead(it, n, total, small) {
    const title = it.pageTitle || it.name, len = String(title || '').length, k = small ? 0.72 : len > 110 ? 0.72 : len > 70 ? 0.84 : 1;
    const st = k < 1 ? Object.assign(sty('posTitle'), { sz: Math.round(sty('posTitle').sz * k), mk: TPL.design ? 'KPS_posTitle' : '' }) : 'posTitle';
    if (k < 1) RUNSTY = 'posTitle';
    const wb = small ? 300 : 454, wg = 227, wr = BLK.equipPrice ? 2500 : 0, wm = W - wb - wg - wr;
    const bd = B(null, null, [6, LINE]), Mr = [0, 0, 170, 0];
    const mid = p(r(txt('positionKicker', { n, total }), 'label'), { after: 30, line: 240, keep: true }) + p(r(title, st), { line: 240, keep: true });
    const cells = [tc(badge(n, wb, small ? 'badge' : 'badgeLarge'), wb, { bdr: bd, va: 'center', mar: Mr }), tc(END, wg, { bdr: bd, mar: Mr }), tc(mid, wm, { bdr: bd, va: 'center', mar: Mr })];
    if (wr) {
      const q = txt('positionQty', { qty: +it.qty || 0 }) + (optsOf(it).length ? ' ' + T.withOptions : '');
      cells.push(tc(p(r(q, 'label'), { jc: 'right', after: 20, line: 240 }) + p(r(money(itemTotal(it)) + NB + curSh(CURRENT), 'posSum'), { jc: 'right', line: 240 }), wr, { bdr: bd, va: 'center', mar: Mr }));
    }
    const ws = wr ? [wb, wg, wm, wr] : [wb, wg, wm];
    return keepAll(tbl([cells], ws)) + spacer(small ? 170 : 280);
  }

  // ключевые параметры позиции — числа с единицами: выделенные синим строки характеристик (или первые три, если выделенных
  // нет), полными рядами по три; текстовые («В кожухе», «EXP») — только в таблице характеристик
  function keyParams(it) {
    const rows = specGroups(it).flatMap(g => g.rows.filter(x => x.k && x.v && NUMVAL.test(String(x.v)) && String(x.v).length <= RULES.keyParamMaxChars));
    let list = rows.filter(x => x.hl);
    if (!list.length) list = rows.slice(0, 3);
    return fullRows(list.slice(0, Math.max(0, +RULES.keyParamsMax || 0)));
  }
  // «2,2 м³/мин» → крупно «2,2», мельче «м³/мин»; «до 10 атм» → мельче «до», крупно «10», мельче «атм»; не число — целиком крупно
  const numUnit = v => {
    const q = /^((?:до|от|не\s+более|не\s+менее|не\s+выше|не\s+ниже)\s+|[≤≥<>~±]\s*)?(.*)$/i.exec(String(v || '').trim());
    const m = /^([\d\s.,–—\-×xх]*\d)\s*([^\d\s].*)?$/.exec(q[2]);
    return m ? [m[1].trim(), m[2] || '', (q[1] || '').trim()] : [String(v || ''), '', ''];
  };
  // плитки ключевых параметров: значение крупно, подпись мелко; per — плиток в ряду
  function tilesXml(kp, wr, per) {
    const w = Math.floor(wr / per), ws = Array.from({ length: per }, (_, i) => i === per - 1 ? wr - w * (per - 1) : w), rows = [];
    for (let i = 0; i < kp.length; i += per) rows.push(ws.map((wj, j) => {
      const x = kp[i + j], last = i + per >= kp.length;
      if (!x) return tc(END, wj, { mar: NOM });
      const [num, unit, pre] = numUnit(String(x.v).replace(/\s*\([^)]*\)\s*$/, ''));
      return tc(p((pre ? r(pre + ' ', 'heroUnit') : '') + r(num, 'heroValue') + (unit ? r(' ' + unit, 'heroUnit') : ''), { after: 25, line: 240 }) + p(r(x.k, 'heroLabel'), { line: 240 }), wj,
        { bdr: B(null, j ? [4, HAIR] : null, last ? null : [4, HAIR]), va: 'top', mar: [85, j ? 170 : 0, 95, 100] });
    }));
    return tbl(rows, ws);
  }
  // пункт «+ опция» с висячим отступом
  const optPara = (name, st, o) => p(marker('+', sty(st, { color: GRAY, b: true })) + r(name, st), Object.assign({ after: 20, line: 264, indL: 215, hang: 215, tab0: true }, o || {}));

  // первый экран: слева фото (плитка с рамкой), справа логотип, плитки ключевых параметров и коротко о главном.
  // keep — держится с заголовком позиции на одном листе, after — продолжение под ним. Правая колонка — не выше фото
  // (HERO_SPARE — запас): что рядом с фото не помещается, уходит ниже — описания в «Особенности и комплектация» (rest),
  // опции — списком под фото; так позиция начинается на том же листе, если на нём помещаются заголовок, фото и плитки.
  // Каждая позиция с нового листа (posNewPage) — правая колонка до 72 % листа, как раньше. Без фото: с заголовком —
  // логотип, плитки и первое описание
  function heroXml(it, m, feats, opts, rest) {
    const kp = BLK.equipKeyParams ? keyParams(it) : [];
    const [wl, wg, wr] = m.tile ? cols([4309, 340, 5557]) : [0, 0, W];
    const [cx, cy] = m.tile ? fit(m.tile, Math.min(cm(RULES.equipPhotoWidthCm), wl * E), cm(RULES.heroPhotoHeightCm)) : [0, 0];
    const fh = f => (f.label ? Fit.h(f.label, wr, 'featureLabel', 240, 140, 30) : 0) + Fit.h(f.text || '', wr, 'featureText', 270);
    const optsH = list => (list.length ? Fit.h(T.equipOptionsTitle, wr, 'featureLabel', 240, 160, 30) + list.reduce((a, o) => a + Fit.h('+ ' + o.name, wr - 215, 'featureText', 264, 0, 20), 0) : 0);
    let below = [];
    if (m.tile && rest) {
      let est = (m.logo && BLK.equipLogo ? 760 : 0) + (kp.length ? Math.ceil(kp.length / 3) * 700 + 200 : 0) + feats.reduce((a, f) => a + fh(f), 0) + optsH(opts);
      const budget = RULES.posNewPage ? Math.max(Math.round(cy / E) + HERO_SPARE, Math.round(PAGEH * 0.72)) : Math.round(cy / E) + HERO_SPARE;
      while (feats.length > 1 && est > budget) { const f = feats.pop(); est -= fh(f); rest.unshift(f); }
      if (est > budget && opts.length) { below = opts; opts = []; }
    }
    const featXml = (list, from) => list.map((f, j) => {
      const i = j + from;
      return (f.label ? p(r(f.label, 'featureLabel'), { before: i ? 140 : 0, after: 30, keep: true }) : '') +
        Typo.paras(f.text || '', 'featureText', { line: 270, hy: true, before: !f.label && i ? 140 : 0 });
    }).join('');
    const optsXml = (list, before) => (list.length ? p(r(T.equipOptionsTitle, 'featureLabel'), { before, after: 30, keep: true }) + list.map(o => optPara(o.name, 'featureText')).join('') : '');
    let top = '';
    if (m.logo && BLK.equipLogo) { const [lx, ly] = fit(m.logo, cm(RULES.logoWidthCm), 560000); top += p(img(m.logo.rid, lx, ly, 'Логотип', 'logoWidthCm'), { after: 160 }); }
    if (kp.length) top += tilesXml(kp, wr, Math.min(3, kp.length)) + spacer(200);
    if (!m.tile) return { keep: top + featXml(feats.slice(0, 1), 0), after: featXml(feats.slice(1), 1) + optsXml(opts, feats.length ? 160 : 0) };
    const right = top + featXml(feats, 0) + optsXml(opts, feats.length ? 160 : 0);
    const photo = p(img(m.tile.rid, cx, cy, it.name, 'equipPhotoWidthCm'), { jc: 'center', after: it.photoCaption ? 100 : 0 }) +
      (it.photoCaption ? p(r(it.photoCaption, 'photoCaption'), { jc: 'center', line: 240 }) : '');
    return { keep: tbl([[tc(photo, wl, { va: 'top', mar: NOM }), gapCell(wg), tc(right + END, wr, { va: 'top', mar: NOM })]], [wl, wg, wr]), after: optsXml(below, 200) };
  }
  const HERO_SPARE = 600;   // правая колонка первого экрана может быть выше фото на столько (твипы)

  // узлы и компоненты: горизонтальные карточки — небольшое фото слева, подзаголовок и текст справа
  function componentsXml(list, fimg) {
    const out = [subheading(T.componentsTitle)];
    const [wi, wg, wt] = cols([Math.round(RULES.componentPhotoWidthCm * 567), 280, BASEW - Math.round(RULES.componentPhotoWidthCm * 567) - 280]);
    list.forEach((f, n) => {
      const g = fimg[f.id], [cx, cy] = fit(g, (wi - 200) * E, cm(RULES.componentPhotoHeightCm));
      const pic = tc(p(img(g.rid, cx, cy, f.label || 'Узел', 'componentPhotoWidthCm'), { jc: 'center' }), wi, { bdr: B(FRAME, FRAME, FRAME, FRAME), va: 'center', mar: [100, 100, 100, 100] });
      const tx = tc((f.label ? p(r(f.label, 'componentLabel'), { after: 60, keep: true }) : '') + Typo.paras(f.text || '', 'componentText', { line: 264, hy: true }), wt, { va: 'center', mar: [40, 0, 40, 0] });
      if (n) out.push(spacer(160));
      out.push(tbl([[pic, gapCell(wg), tx]], [wi, wg, wt]));
    });
    return out.join('');
  }

  // особенности и комплектация: список «подзаголовок слева — текст справа»
  function featuresXml(list) {
    const [wl, wt] = cols([2268, 7938]);
    const rows = list.map((f, i) => {
      const bd = i < list.length - 1 ? B(null, null, [4, HAIR]) : B();
      const row = [tc(p(r(f.label || '', 'featureLabel'), { line: 240 }), wl, { bdr: bd, va: 'top', mar: [125, 0, 115, 227] }),
        tc(Typo.paras(f.text || '', 'featureText', { line: 270, hy: true }), wt, { bdr: bd, va: 'top', mar: [100, 0, 115, 0] })];
      return i === 0 && list.length > 1 && String(f.text || '').length < 400 ? keepRow(row) : row;
    });
    return subheading(T.featuresTitle) + tbl(rows, [wl, wt]);
  }

  // карточка группы характеристик: светлая строка с названием группы (повторяется при переносе) и строки;
  // длинное значение (перечень, условия) — текстом во всю ширину карточки под названием параметра
  function specCard(g, w) {
    const wk = Math.round(w * 0.53), wv = w - wk, n = g.rows.length;
    const title = g.cont ? txt('specCont', { name: g.name || T.specsTitle }) : (g.name || T.specsTitle);
    const rows = [keepRow([tc(p(r(title, 'specGroup'), { line: 240 }), w, { span: 2, fill: LIGHT, mar: [75, 136, 70, 136] })])];
    g.rows.forEach((x, i) => {
      const bd = B(null, null, [4, HAIR]);
      const row = String(x.v || '').length > RULES.specLongValueChars
        ? [tc(p(r(x.k, 'specName'), { after: 40, line: 240, keep: true }) + Typo.paras(x.v, x.hl ? 'specValueKey' : String(x.v).length <= 70 ? 'specValue' : 'specText', { line: 252, hy: true }), w,
          { span: 2, bdr: bd, mar: [60, 136, 70, 100] })]
        : [tc(p(r(x.k, 'specName'), { line: 240 }), wk, { bdr: bd, va: 'top', mar: [54, 136, 54, 80] }),
          tc(p(r(x.v, specVal(x)), { line: 240 }), wv, { bdr: bd, va: 'top', mar: [54, 0, 54, 100] })];
      rows.push(keepTail(i, n) ? keepRow(row) : row);
    });
    return tbl(rows, [wk, wv], { header: true });
  }
  // высота карточки (твипы) при ширине w — для раскладки групп по двум колонкам: каждая следующая — в более короткую
  const cardH = (g, w) => {
    const wk = Math.round(w * 0.53), wv = w - wk;
    return 380 + g.rows.reduce((a, x) => {
      const k = String(x.k || ''), v = String(x.v || '');
      if (v.length > RULES.specLongValueChars) return a + 150 + Fit.h(k, w - 260, 'specName', 240, 0, 40) + Fit.h(v, w - 260, x.hl ? 'specValueKey' : v.length <= 70 ? 'specValue' : 'specText', 252);
      return a + 108 + Math.max(Fit.h(k, wk - 220, 'specName', 240), Fit.h(v, wv - 100, specVal(x), 240));
    }, 0);
  };
  function specsXml(groups) {
    // пояснение «Синим — ключевые параметры…» — справа в строке заголовка: не отрывается от таблицы
    const out = [subheading(T.specsTitle, null, null, BLK.specNote ? T.specNote : '')];
    const nrows = groups.reduce((a, g) => a + g.rows.length + 1, 0);
    if (nrows < RULES.specTwoColumnsFrom) {
      groups.forEach((g, i) => { if (i) out.push(spacer(180)); out.push(specCard(g, W)); });
    } else {
      // карточки групп — в две независимые колонки, каждая следующая — в ту, что короче;
      // группа больше половины всех строк делится пополам: вторая половина — «… (продолжение)»
      const gs = [];
      for (const g of groups) {
        if (g.rows.length >= 8 && g.rows.length + 1 > nrows * 0.55) { const k = Math.ceil(g.rows.length / 2); gs.push({ name: g.name, rows: g.rows.slice(0, k) }, { name: g.name, rows: g.rows.slice(k), cont: true }); }
        else gs.push(g);
      }
      const [c1, cg, c2] = cols([4961, 284, 4961]), A = [], Bc = [];
      let ha = 0, hb = 0;
      for (const g of gs) { const h = cardH(g, c1) + 200; if (ha <= hb) { A.push(g); ha += h; } else { Bc.push(g); hb += h; } }
      const stack = (list, w) => list.map((g, i) => (i ? spacer(180) : '') + specCard(g, w)).join('') + END;
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
    const per = list.filter(g => !g.wide).length >= 3 ? 3 : 2, GAP = X(284), CW = Math.floor((W - GAP * (per - 1)) / per), FULL = W;
    const card = (g, w, boxW, boxH) => {
      const [cx, cy] = fit(g, boxW, boxH);
      const body = p(img(g.rid, cx, cy, g.caption || 'Изображение'), { jc: 'center', after: g.caption ? 80 : 0 }) +
        (g.caption ? p(r(g.caption, 'galleryCaption'), { jc: 'center', line: 240 }) : '');
      return tc(body, w, { bdr: B(FRAME, FRAME, FRAME, FRAME), va: 'center', mar: [140, 120, 140, 120] });
    };
    const box = [(CW - 260) * E, Math.round((per === 3 ? 1450000 : list.length <= 2 ? 1450000 : 1850000) * GAL)], fullBox = [(FULL - 260) * E, Math.round(3600000 * GAL)];
    const sheetBox = [(FULL - 260) * E, Math.max(7200000, Math.min(8600000, PAGEH * E - 1300000))];
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
      if (n) out.push(spacer(180));
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
  // характеристики «параметр — значение»: короткие — сеткой (в две пары колонок, если их больше шести),
  // длинные (перечни, описания систем) — абзацами во всю ширину под сеткой
  class KV {
    // o.cols — колонок пар «параметр — значение» (по умолчанию две, если коротких строк больше шести)
    static xml(rows, wt, o = {}) {
      const isShort = z => String(z.v || '').length <= 40 && String(z.k || '').length <= 48;
      const short = rows.filter(isShort), long = rows.filter(z => !isShort(z));
      let x = short.length ? KV.grid(short, wt, o.cols !== 1 && short.length > 6) + END : '';
      long.forEach((z, i) => { x += p(r(z.k, 'specName'), { before: i || short.length ? 80 : 0, after: 20, keep: true, line: 240 }) +
        Typo.paras(z.v, z.hl ? 'specValueKey' : String(z.v).length <= 70 ? 'specValue' : 'specText', { line: 252, hy: true }); });
      return x;
    }
    static grid(rows, wt, two) {
      const per = two ? Math.ceil(rows.length / 2) : rows.length, w1 = two ? Math.floor((wt - 160) / 2) : wt;
      const kv = (z, w) => { const wk = Math.round(w * 0.52), bd = B(null, null, z ? [4, HAIR] : null);
        return [tc(p(r(z ? z.k : '', 'specName'), { line: 240 }), wk, { bdr: bd, mar: [45, 0, 45, 80] }),
          tc(p(r(z ? z.v : '', z && z.hl ? 'specValueKey' : 'specValue'), { line: 240 }), w - wk, { bdr: bd, mar: [45, 60, 45, 0] })]; };
      const tr = [];
      for (let i = 0; i < per; i++) tr.push(two ? kv(rows[i], w1).concat([gapCell(wt - 2 * w1)], kv(rows[i + per], w1)) : kv(rows[i], w1));
      const ws = two ? [Math.round(w1 * 0.52), w1 - Math.round(w1 * 0.52), wt - 2 * w1, Math.round(w1 * 0.52), w1 - Math.round(w1 * 0.52)] : [Math.round(wt * 0.52), wt - Math.round(wt * 0.52)];
      return tbl(tr, ws);
    }
  }
  function kitXml(it, m, pos) {
    const parts = kitOf(it), imgs = m.kitImgs || {}, out = [];
    if (BLK.equipKit) {
      out.push(subheading(T.kitTitle));
      const wc = cols([680, 3800, 1000, 4726]), HL = B(null, null, [4, HAIR]), Mr = [85, 100, 85, 100];
      const head = [T.colNo, T.kitColName, T.colQty, T.kitColParams].map((t, i) => HDR(t, wc[i], i === 0 || i === 2 ? 'center' : 'left'));
      const rows = [head].concat(parts.map((x, i) => {
        const short = (x.rows || []).filter(z => String(z.v).length <= 40), main = short.filter(z => !/^(модель|марка|производитель|тип|бренд)/i.test(z.k));
        const key = (main.length ? main : short).slice(0, Math.max(0, +RULES.kitKeyParams || 0)).map(z => z.k + ': ' + z.v).join('; ');
        const sub = [x.maker, x.model].filter(Boolean).join(' ');
        const row = [tc(p(r(pos + '.' + (i + 1), 'rowIndex'), { jc: 'center' }), wc[0], { bdr: HL, mar: Mr }),
          tc(p(r(x.name, 'cellBold'), { line: 240 }) + (sub && !x.name.includes(sub) ? p(r(sub, 'muted'), { before: 20, line: 240 }) : ''), wc[1], { bdr: HL, mar: Mr }),
          tc(p(r(pcsOf(+x.qty || 1), 'cell'), { jc: 'center' }), wc[2], { bdr: HL, mar: Mr }),
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
        let body = p(r(pos + '.' + (parts.indexOf(x) + 1) + '  ' + kitName(x), 'cardTitle'), { after: 60, keep: true });
        if (x.maker && !x.name.includes(x.maker)) body += p(r(txt('kitMaker', { maker: [x.maker, x.model].filter(Boolean).join(' ') }), 'muted'), { after: 60 });
        if (x.desc) body += Typo.paras(x.desc, 'componentText', { line: 264, hy: true, after: (x.rowsKp || x.rows || []).length ? 80 : 0 });
        const kr = x.rowsKp || x.rows || []; if (kr.length) body += KV.xml(kr, g ? wt : wt - 200) + END;
        if (n) out.push(spacer(200));
        if (g) {
          const [cx, cy] = fit(g, (wi - 160) * E, cm(RULES.kitPhotoHeightCm));
          out.push(tbl([[tc(p(img(g.rid, cx, cy, x.name, 'kitPhotoWidthCm'), { jc: 'center' }), wi, { bdr: B(FRAME, FRAME, FRAME, FRAME), va: 'top', mar: [80, 60, 80, 60] }),
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
      return Card.rows(it) <= RULES.compactMaxRows && Card.chars(it) <= RULES.compactMaxChars && ((BLK.equipGallery && m.gallery) || []).length <= 2;
    }
    // совсем небольшая позиция (ресивер, фильтр, ЗИП) — карточкой в половину ширины, по две в ряд
    static half(it, m) {
      return Card.fits(it, m) && Card.rows(it) <= RULES.cardHalfRows && Card.chars(it) <= RULES.cardHalfChars &&
        !((BLK.equipGallery && m.gallery) || []).length && optsOf(it).length <= Card.HALF_OPTS;
    }
    static rows(it) { return specGroups(it).reduce((a, g) => a + g.rows.length, 0); }
    static chars(it) { return (it.features || []).reduce((a, f) => a + String(f.text || '').length + String(f.label || '').length, 0); }
    // две карточки рядом (list — [позиция, картинки, номер]): ряд не разрывается между листами
    static pair(list, total) {
      const gap = X(227), w1 = Math.floor((W - gap) / 2), w2 = W - gap - w1, pad = Card.PAD;
      const cells = list.map(([it, m, n], i) => tc(Card.halfBody(it, m, n, total, (i ? w2 : w1) - 2 * pad) + END, i ? w2 : w1,
        { bdr: B(FRAME, FRAME, FRAME, FRAME), va: 'top', mar: [pad, pad, pad, pad] }));
      return tbl([[cells[0], gapCell(gap), cells[1]]], [w1, gap, w2]) + spacer(200);
    }
    // карточка в половину ширины: номер, «Позиция N из M», название, количество и сумма; фото; описание, опции и
    // характеристики одной колонкой
    static halfBody(it, m, n, total, w) {
      const wb = 300, wg = 170, wm = w - wb - wg;
      const q = txt('positionQty', { qty: +it.qty || 0 }) + (optsOf(it).length ? ' ' + T.withOptions : '');
      const mid = p(r(txt('positionKicker', { n, total }), 'label'), { after: 30, line: 240 }) + p(r(it.pageTitle || it.name, 'cardTitle'), { line: 240 }) +
        (BLK.equipPrice ? p(r(q + ' · ', 'muted') + r(money(itemTotal(it)) + NB + curSh(CURRENT), 'cellBold'), { before: 40, line: 240 }) : '');
      let x = tbl([[tc(badge(n), wb, { va: 'top', mar: [20, 0, 0, 0] }), gapCell(wg), tc(mid, wm, { va: 'top', mar: NOM })]], [wb, wg, wm]);
      if (m.tile) { const [cx, cy] = fit(m.tile, w * E, cm(Card.HALF_PHOTO_CM)); x += p(img(m.tile.rid, cx, cy, it.name), { jc: 'center', before: 160 }); }
      if (m.logo && BLK.equipLogo) { const [lx, ly] = fit(m.logo, cm(Math.min(+RULES.logoWidthCm || 3, 2.6)), 330000); x += p(img(m.logo.rid, lx, ly, 'Логотип', 'logoWidthCm'), { before: 140 }); }
      (it.features || []).filter(f => f.label || f.text).forEach(f => {
        if (f.label) x += p(r(f.label, 'featureLabel'), { before: 140, after: 30, keep: true });
        if (String(f.text || '').trim()) x += Typo.paras(f.text, 'featureText', { line: 264, hy: true, before: f.label ? 0 : 140 });
      });
      const opts = BLK.equipOptions ? optsOf(it) : [];
      if (opts.length) { x += p(r(T.equipOptionsTitle, 'featureLabel'), { before: 140, after: 30, keep: true }); opts.forEach(o => { x += optPara(o.name, 'featureText'); }); }
      const groups = BLK.equipSpecs ? specGroups(it) : [];
      groups.forEach(g => {
        x += p(r(groups.length > 1 && g.name ? g.name : T.specsTitle, 'featureLabel'), { before: 140, after: 50, keep: true, line: 240 });
        x += KV.xml(g.rows, w, { cols: 1 });
      });
      return x;
    }
    // карточка во всю ширину: строка-заголовок, слева фото, справа описание и характеристики; не разрывается
    static xml(it, m, n, total) {
      const gal = BLK.equipGallery ? (m.gallery || []) : [];
      const [wl, wg, wr] = m.tile || gal.length ? cols([2835, 340, 7031]) : [0, 0, W];
      // слева — фото (плитка с рамкой), под ним картинки галереи (две — рядом); справа — логотип, описание, опции, характеристики
      let left = '';
      if (m.tile) { const [cx, cy] = fit(m.tile, wl * E, cm(3.4)); left += p(img(m.tile.rid, cx, cy, it.name), { jc: 'center' }); }
      if (gal.length) {
        const two = gal.length === 2, gw = two ? Math.floor((wl - 120) / 2) : wl;
        left += p(gal.map(g => { const [cx, cy] = fit(g, (gw - 80) * E, cm(m.tile ? 1.7 : 2.6)); return img(g.rid, cx, cy, g.caption || it.name); }).join(two ? '<w:r><w:t xml:space="preserve">  </w:t></w:r>' : ''),
          { jc: 'center', before: m.tile ? 120 : 0 });
        const caps = gal.map(g => g.caption).filter(Boolean);
        if (caps.length) left += p(r(caps.join(' · '), 'photoCaption'), { jc: 'center', before: 40, line: 240 });
      }
      let right = '';
      if (m.logo && BLK.equipLogo) { const [lx, ly] = fit(m.logo, cm(Math.min(+RULES.logoWidthCm || 3, 2.6)), 330000); right += p(img(m.logo.rid, lx, ly, 'Логотип', 'logoWidthCm'), { after: 100 }); }
      // описание: подзаголовок отдельной строкой, текст под ним
      (it.features || []).filter(f => f.label || f.text).forEach((f, i) => {
        const tx = String(f.text || '');
        if (f.label) right += p(r(f.label, 'featureLabel'), { before: i ? 100 : 0, after: 30, keep: true });
        if (tx.trim()) right += Typo.paras(tx, 'featureText', { line: 264, hy: true, before: !f.label && i ? 100 : 0 });
      });
      const opts = BLK.equipOptions ? optsOf(it) : [];
      if (opts.length) { right += p(r(T.equipOptionsTitle, 'featureLabel'), { before: 120, after: 30, keep: true }); opts.forEach(o => { right += optPara(o.name, 'featureText'); }); }
      const groups = BLK.equipSpecs ? specGroups(it) : [];
      groups.forEach((g, i) => {
        right += p(r(groups.length > 1 && g.name ? g.name : T.specsTitle, 'featureLabel'), { before: i || right ? 140 : 0, after: 50, keep: true, line: 240 });
        right += KV.xml(g.rows, wr);
      });
      const body = wl
        ? tbl([[tc(left, wl, { va: 'top', mar: NOM }), gapCell(wg), tc(right + END, wr, { va: 'top', mar: NOM })]], [wl, wg, wr])
        : right + END;
      return keepBlock(posHead(it, n, total, true) + body) + spacer(200);
    }
  }
  Card.PAD = 170;            // поля карточки в половину ширины
  Card.HALF_PHOTO_CM = 3;    // высота фото в ней, см
  Card.HALF_OPTS = 3;        // опций у такой позиции — не больше

  // lead — разрыв листа или отступ перед позицией
  function equipXml(it, M, n, total, lead) {
    const m = M.items[it.id] || {};
    const fimg = BLK.equipComponents ? (m.featImgs || {}) : {};
    const allF = (it.features || []).filter(f => f.label || f.text);
    const illustrated = allF.filter(f => f.id && fimg[f.id]);
    // длинные тексты (о серии, комплектация) — списком ниже; короткие — на первом экране рядом с фото
    const longF = allF.filter(f => !(f.id && fimg[f.id]) && (f.text || '').length > RULES.longFeatureChars);
    const feats = allF.filter(f => !(f.id && fimg[f.id]) && !longF.includes(f));
    const opts = BLK.equipOptions ? optsOf(it) : [];
    const rest = [];
    const hero = heroXml(it, m, feats, opts, BLK.equipFeatures ? rest : null);
    const out = [lead + keepBlock(posHead(it, n, total) + HEADMARK + hero.keep) + hero.after];
    // сборное изделие (it.asm): сначала изделие целиком — описание и сводные характеристики, затем состав и карточки частей
    const kitAt = it.asm ? 'end' : 'start';
    if (kitOf(it).length && kitAt === 'start') out.push(kitXml(it, m, n));
    if (illustrated.length) out.push(componentsXml(illustrated, fimg));
    if ((rest.length || longF.length) && BLK.equipFeatures) out.push(featuresXml(rest.concat(longF)));
    const groups = BLK.equipSpecs ? specGroups(it) : [];
    if (groups.length) out.push(specsXml(groups));
    if (kitOf(it).length && kitAt === 'end') out.push(kitXml(it, m, n));
    if (BLK.equipGallery) out.push(galleryXml(m.gallery));
    return out.join('');
  }
  function hasEquipPage(it, M) {
    const m = M.items[it.id];
    return it.page && ((it.options || []).some(o => o.name) || kitOf(it).length || (it.groups && it.groups.some(g => g.rows && g.rows.some(x => x.k || x.v))) ||
      (m && m.tile) || ((m && m.gallery) || []).length || Object.keys((m && m.featImgs) || {}).length || (it.features || []).some(f => f.text));
  }
  // раздел «Оборудование»: позиции подряд — следующая начинается на том же листе, если на нём помещаются её заголовок,
  // фото и плитки (иначе Word и LibreOffice переносят этот блок на новый лист); каждая с нового листа — правило posNewPage,
  // первая — по разделу («с новой страницы»). Небольшие (Card.fits) — карточками, совсем небольшие (Card.half) — по две
  // в ряд; карточки — когда страниц оборудования не меньше compactFrom (одна-две позиции — всегда полной страницей).
  // Номер позиции — как в «Стоимости и условиях».
  function equipmentXml(S, M, sec) {
    const list = S.items.filter(it => hasEquipPage(it, M)), cards = list.length >= RULES.compactFrom, total = S.items.length;
    const mOf = it => M.items[it.id] || {}, nOf = it => S.items.indexOf(it) + 1, out = [];
    let prev = '';
    for (let i = 0; i < list.length; i++) {
      const it = list[i], m = mOf(it), small = cards && Card.fits(it, m);
      let lead;
      if (i === 0) lead = sec && sec.fresh ? '' : sec && sec.newPage ? newPage() : spacer(480);
      else if (!small && RULES.posNewPage) lead = newPage();
      else lead = spacer(small && prev === 'card' ? 300 : 480);
      if (!small) { out.push(equipXml(it, M, nOf(it), total, lead)); prev = 'page'; continue; }
      // начало раздела (свои картинки и надписи шаблона) — перед первой карточкой; у крупной позиции — под её заголовком
      lead += i === 0 ? HEADMARK : '';
      const next = list[i + 1];
      if (Card.half(it, m) && next && Card.half(next, mOf(next))) {
        out.push(lead + Card.pair([[it, m, nOf(it)], [next, mOf(next), nOf(next)]], total));
        i++;
      } else out.push(lead + Card.xml(it, m, nOf(it), total));
      prev = 'card';
    }
    return out.join('');
  }

  // ================================================================ КОНТАКТНАЯ ИНФОРМАЦИЯ
  // светлая плашка: менеджер и прощание, телефоны и почта; «Как заказать» — три шага; о компании и наши клиенты
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
    return p(stamp + r(T.signLine + NB, 'label') + sign, { before: 240 });
  }

  // заголовок, плашка менеджера и «Как заказать» — одним блоком (не делится между листами; после последней позиции —
  // на том же листе, если помещается); «О компании» и «Наши клиенты» — следом
  function contactsXml(S, sec, M, floats) {
    const lead = sec && sec.fresh ? '' : sec && sec.newPage ? newPage() : spacer(520);
    const out = [heading(T.contactsTitle, false)];
    const m = S.manager || {};
    const PADX = 340, wi = W - 2 * PADX;
    const tw2 = [Math.round(wi * 0.62), wi - Math.round(wi * 0.62)];
    const top = tbl([[tc(p(r(m.name || '', 'managerName'), { after: 40, line: 240 }) + (m.position ? p(r(m.position, 'managerPost'), { line: 252 }) : ''), tw2[0], { va: 'bottom', mar: [0, 0, 0, 0] }),
      tc(p(r(T.closing1, 'closing'), { jc: 'right', line: 252 }) + p(r(T.closing2, 'closing'), { jc: 'right', line: 252 }), tw2[1], { va: 'bottom', mar: [0, 0, 0, 0] })]], tw2);
    const cell = (lab, val, w) => tc(p(r(lab, 'label'), { after: 50, line: 240 }) + p(val, { line: 240 }), w, { va: 'top', mar: [0, 0, 0, 200] });
    const items = [];
    if (m.phone) items.push([T.phone, Typo.solid(m.phone, 'contactPhone') + (m.ext ? r(txt('ext', { ext: m.ext }), 'contactExt') : '')]);
    if (m.mobile) items.push([T.mobile, Typo.solid(m.mobile, 'contactPhone')]);
    if (m.email) items.push([T.email, hyper('rIdMail', r(m.email, Object.assign(sty('contactLink'), { solid: true })))]);
    if (m.site) items.push([T.site, hyper('rIdSite', r(m.site, Object.assign(sty('contactLink'), { solid: true })))]);
    if (m.hours) items.push([T.hours, r(m.hours, 'contactValue')]);
    if (m.address) items.push([T.address, r(m.address, 'contactValue')]);
    let grid = '';
    for (let i = 0; i < items.length; i += 3) {
      const ws = [Math.floor(wi / 3), Math.floor(wi / 3), wi - 2 * Math.floor(wi / 3)];
      grid += spacer(i ? 160 : 260) + tbl([ws.map((w, j) => items[i + j] ? cell(items[i + j][0], items[i + j][1], w) : tc(END, w, { mar: NOM }))], ws);
    }
    out.push(tbl([[tc(top + grid + END, W, { fill: LIGHT, va: 'top', mar: [300, PADX, 280, PADX] })]], [W]));
    // как заказать: три шага с номером
    const steps = BLK.contactsHow ? [T.how1, T.how2, T.how3].filter(Boolean) : [];
    if (steps.length) {
      out.push(subheading(T.howTitle, 340));
      const n = steps.length, gap = 227, sw = Math.floor((W - gap * (n - 1)) / n), cells = [], ws = [];
      steps.forEach((s, i) => {
        if (i) { cells.push(gapCell(gap)); ws.push(gap); }
        const wv = i === n - 1 ? W - (sw + gap) * (n - 1) : sw, wbd = 284, wgp = 140;
        const num = tbl([[tc(p(r(String(i + 1), 'howNumber'), { jc: 'center', line: 240 }), wbd, { fill: SKY, mar: NOM, va: 'center' })]], [wbd], { heights: { 0: wbd } }) + END;
        cells.push(tc(num, wbd, { va: 'top', mar: [20, 0, 0, 0] }), gapCell(wgp), tc(p(r(s, 'howText'), { line: 252 }), wv - wbd - wgp, { va: 'top', mar: NOM }));
        ws.push(wbd, wgp, wv - wbd - wgp);
      });
      out.push(tbl([cells], ws));
    }
    const kept = lead + keepBlock(out.splice(0).join(''));
    out.push(kept);
    // о компании (слева) и наши клиенты (справа, картинка шаблона, если включено в КП)
    const about = BLK.contactsAbout && TPL.about, AD = BLK.contactsAdvantages ? (TPL.advantages || []).slice(0, RULES.advantagesMax) : [];
    const cl = S.showClients && TPL.clients && TPL.clients.rid ? TPL.clients : null;
    if (about || AD.length || cl) {
      const wc = cl ? Math.min(tw(RULES.clientsWidthCm || 7.5), Math.round(W * 0.48)) : 0, wgp = cl ? 454 : 0, wa = W - wc - wgp;
      let left = '';
      if (about || AD.length) {
        left += subheading(T.aboutTitle, 0, 120);
        if (about) left += p(brandRuns('aboutBrand') + r(TPL.about, 'about'), { after: 160, line: 276, hy: true });
        AD.forEach(([ti, tx]) => { left += p(r(ti, 'advTitle'), { before: 100, after: 20, line: 240, keep: true }) + p(r(tx, 'advText'), { line: 252, hy: true }); });
      }
      let right = '';
      if (cl) {
        const k = Math.min(wc * E / cl.w, cm(13) / cl.h);
        right = subheading(TPL.clientsTitle || '', 0, 120) + p(img(cl.rid, Math.round(cl.w * k), Math.round(cl.h * k), 'Логотипы клиентов', 'clientsWidthCm'), { jc: 'center' });
      }
      const cells = [tc((left || END) + END, wa, { va: 'top', mar: NOM })].concat(cl ? [gapCell(wgp), tc(right + END, wc, { va: 'top', mar: NOM })] : []);
      out.push(spacer(340) + tbl([cells], cl ? [wa, wgp, wc] : [wa], { split: true }));
    }
    out.push(signXml(M, floats));
    return out.join('');
  }

  // ================================================================ НИЖНИЙ КОЛОНТИТУЛ
  // фирменный знак · ваш менеджер, телефон и почта — слева; «стр. N из M» — справа
  let CURRENT = null;
  function footerXml(S, root) {
    if (!BLK.footer) return root + END + '</w:ftr>';
    const m = S.manager || {}, TOP = line('top', 5, HAIR) + '<w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/>';
    const w2 = cols([8206, 2000]);
    let left = brandRuns('footerBrand');
    if (m.name) left += r(' · ' + T.footerManager + ' ', 'footer') + r(m.name, 'footerBold');
    if (m.phone) left += r(' · ', 'footer') + Typo.solid(m.phone, 'footer');
    if (m.email) left += r(' · ' + m.email, Object.assign(sty('footer'), { solid: true }));
    const right = p(pageOf('footer', 'footerPage'), { jc: 'right', line: 240 });
    return root + tbl([[tc(p(left, { line: 240 }), w2[0], { bdr: TOP, mar: [100, 0, 0, 0] }), tc(right, w2[1], { bdr: TOP, mar: [100, 0, 0, 0] })]], w2) + END + '</w:ftr>';
  }

  // ================================================================ ШАПКА ВНУТРЕННИХ СТРАНИЦ
  // синяя полоса слева во всю высоту листа, логотип; справа — «Коммерческое предложение № … от …» и клиент;
  // своя надпись в «Шапке» (header.lines) — вместо номера КП и клиента
  function headerXml(S, root) {
    const H = TPL.header || {}, lg = TPL.headerLogo;
    const strip = anchorPara(rect(238, PAGE.h, NAVYD, { page: true, x: 0, y: 0, dx: -PAGE.left, dy: -PAGE.header }));
    const own = String(H.lines || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const vars = { 'клиент': Typo.org(S.client), 'номер': S.number || '', 'дата': S.date ? ruDate(S.date) : '' };
    let info;
    if (own.length) {
      const sz = Math.round((+H.textSize || 7.6) * 2), col = COL(H.textColor || 'GRAY');
      info = own.map((l, i) => p(r(fill(l, vars), { sz, color: i === 0 && H.firstColor ? COL(H.firstColor) : col, b: i === 0 && !!H.firstBold, mk: TPL.design ? 'KPS_headerText' : '' }), { jc: 'right', line: 252 })).join('');
    } else {
      info = p(r(T.headerKp, 'header') + (S.number ? r('№ ' + S.number, 'headerBold') : '') + (S.date ? r(' от ' + ruDate(S.date), 'header') : ''), { jc: 'right', line: 252 }) +
        (S.client ? p(r(T.headerFor, 'header') + r(Typo.org(S.client), 'headerBold'), { jc: 'right', line: 252 }) : '');
    }
    let logo = p('');
    let lw = 0;
    if (lg && lg.rid) {
      const cy = +H.logoHeightCm > 0 ? cm(H.logoHeightCm) : cm(0.66), cx = +H.logoWidthCm > 0 ? cm(H.logoWidthCm) : Math.round(cy * lg.w / lg.h);
      const cy2 = +H.logoWidthCm > 0 && !(+H.logoHeightCm > 0) ? Math.round(cx * lg.h / lg.w) : cy;
      logo = p(img(lg.rid, cx, cy2, 'Логотип компании', 'headerLogo'), { line: 240 });
      lw = Math.min(X(5000), Math.round(cx / E) + 200);
    }
    const bdr = H.rule !== false ? B(null, null, [8, COL(H.ruleColor || 'BLUE')]) : B();
    const cells = lw ? [tc(logo, lw, { bdr, va: 'bottom', mar: [0, 0, 125, 0] }), tc(info, W - lw, { bdr, va: 'bottom', mar: [0, 0, 125, 0] })] : [tc(info, W, { bdr, va: 'bottom', mar: [0, 0, 125, 0] })];
    return root + strip + tbl([cells], lw ? [lw, W - lw] : [W]) + END + '</w:hdr>';
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
     { cover:{file,w,h}, thumbs:{[key]:…}, items:{[id]:{tile, logo, gallery:[…], featImgs:{…}, kitImgs:{[id элемента]:…}}},
       assets:{[ключ]:{file,w,h}} };
     roots — корневые теги document.xml и footer.xml; tpl — настройки шаблона (template.json + base.docx). */
  function build(S, Min, roots, tpl) {
    setTemplate(tpl);
    denser(S.layoutDense);
    PID = 9000; CURRENT = S;
    const media = [], M = { cover: null, items: {} };
    let n = 0;
    const reg = x => { if (!x) return null; const rid = 'rIdImg' + (++n); media.push({ rid, file: x.file }); return Object.assign({ rid }, x); };
    M.cover = reg(Min.cover);
    M.thumbs = {}; for (const k in (Min.thumbs || {})) M.thumbs[k] = reg(Min.thumbs[k]);
    for (const id in (Min.items || {})) M.items[id] = { tile: reg(Min.items[id].tile), logo: reg(Min.items[id].logo), gallery: (Min.items[id].gallery || []).map(reg).filter(Boolean), featImgs: Object.fromEntries(Object.entries(Min.items[id].featImgs || {}).map(([k, v]) => [k, reg(v)])),
      kitImgs: Object.fromEntries(Object.entries(Min.items[id].kitImgs || {}).map(([k, v]) => [k, reg(v)])) };
    M.assets = Object.fromEntries(Object.entries(Min.assets || {}).map(([k, v]) => [k, reg(v)]).filter(([, v]) => v));
    M.sign = { sign: BLK.signImage ? reg((Min.sign || {}).sign) : null, stamp: BLK.stampImage ? reg((Min.sign || {}).stamp) : null };
    const floats = [];
    const parts = {
      cover: () => coverXml(S, M),
      offer: sec => offerXml(S, sec, M),
      conditions: sec => conditionsXml(S, sec, M),
      equipment: sec => equipmentXml(S, M, sec),
      contacts: sec => contactsXml(S, sec, M, floats)
    };
    // свои картинки и надписи шаблона: строкой в начале / конце раздела или свободно на странице (плавающий объект,
    // привязанный к крошечному абзацу на этом месте). floats — плавающие объекты по порядку (для предпросмотра)
    const inline = {}, floating = {};
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
    const lblRuns = (l, ln) => r(ln, { sz: Math.round((+l.size || 10) * 2), color: COL(l.color || 'DARK'), b: !!l.bold, i: !!l.italic, caps: !!l.caps, mk: TPL.design ? 'KPL_' + l.id : '' });
    const lblParas = (l, o) => { RUNSTY = null; return String(fill(l.text || '', vars)).split(/\r?\n/).map(ln => p(ln ? lblRuns(l, ln) : '', Object.assign({ jc: l.align || 'left', line: 260 }, o))).join(''); };
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
    // титул — всегда первым (отдельный раздел Word); первый раздел после него начинается со своей страницы сам
    const order = TPL.sections.filter(s => s.on && parts[s.id]);
    const sorted = order.filter(s => s.id === 'cover').concat(order.filter(s => s.id !== 'cover'));
    let body = '', fresh = true;
    for (const sec of sorted) {
      const s = sec.id === 'cover' ? sec : Object.assign({}, sec, { fresh });
      let part = parts[sec.id](s);
      if (!part) continue;
      if (sec.id === 'cover') {
        part = at('coverTop') + part.replace(COVEREND, at('coverEnd'));
        if (TPL.design) body += `<w:p><w:pPr><w:pStyle w:val="KPSEC_cover"/><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>`;
        body += part;
        fresh = true;
        continue;
      }
      // начало раздела — сразу после заголовка раздела (или в самом начале)
      part = part.indexOf(HEADMARK) < 0 ? at(sec.id + 'Top') + part : part.replace(HEADMARK, at(sec.id + 'Top'));
      if (TPL.design) body += `<w:p><w:pPr><w:pStyle w:val="KPSEC_${sec.id}"/><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>`;
      body += part.split(HEADMARK).join('') + at(sec.id + 'End');
      fresh = false;
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
  // 'kit' — сборки: состав изделия приходит как есть (it.kit.parts), 'assets' — картинки самого шаблона (значки, логотип),
  // 'flow' — позиции подряд: программа проверяет файл в Word и при нужде собирает плотнее (S.layoutDense, rules.sparsePct)
  return { defaults: DEFAULTS, build, features: ['discount', 'header', 'images', 'design', 'kit', 'sign', 'assets', 'flow'] };
}
