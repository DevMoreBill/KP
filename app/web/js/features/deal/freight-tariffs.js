/**
 * Тарифы перевозки по России: классы машин, разгрузка, общие параметры — стандартные (рынок РФ, осень 2026, с НДС 22 %,
 * ставка перевозчика) и сохранённые администратором. Рейс = подача + ставка за км до far км + «дальняя» ставка дальше, не
 * меньше минимального заказа; источники ставок — в DEFAULTS.sources.
 */
export class FreightTariffs {
  static DEFAULTS = {
    ver: 3,
    classes: [
      {
        id: 'gazel',
        name: '«Газель» тент 1,5 т (4,2 м, 17 м³)',
        L: 4.2,
        W: 2.0,
        h: 2.0,
        hMax: 2.0,
        wMax: 2.0,
        t: 1.5,
        open: false,
        km: 43,
        kmFar: 30,
        base: 5000,
        min: 6000,
      },
      {
        id: 't5',
        name: 'Грузовик 5 т (6,2 м, 36 м³)',
        L: 6.2,
        W: 2.45,
        h: 2.4,
        hMax: 2.4,
        wMax: 2.45,
        t: 5,
        open: false,
        km: 64,
        kmFar: 42,
        base: 7000,
        min: 10000,
      },
      {
        id: 't10',
        name: 'Грузовик 10 т (7,5 м, 48 м³)',
        L: 7.5,
        W: 2.45,
        h: 2.6,
        hMax: 2.6,
        wMax: 2.45,
        t: 10,
        open: false,
        km: 80,
        kmFar: 48,
        base: 10000,
        min: 15000,
      },
      {
        id: 'tent20',
        name: 'Фура тент 20 т (13,6 м, 86 м³)',
        L: 13.6,
        W: 2.45,
        h: 2.6,
        hMax: 2.6,
        wMax: 2.45,
        t: 20,
        open: false,
        km: 72,
        kmFar: 40,
        base: 15000,
        min: 20000,
      },
      {
        id: 'cont',
        name: 'Контейнеровоз (контейнер 20 / 40 фут)',
        L: 12.2,
        W: 2.5,
        h: 2.9,
        hMax: 2.9,
        wMax: 2.5,
        t: 28,
        tLegal: 28,
        open: true,
        iso: true,
        km: 78,
        kmFar: 44,
        base: 16000,
        min: 22000,
      },
      {
        id: 'flat',
        name: 'Открытая площадка 20 т (13,6 м)',
        L: 13.6,
        W: 2.5,
        h: 2.6,
        hMax: 3.1,
        wMax: 3.2,
        t: 20,
        open: true,
        km: 82,
        kmFar: 47,
        base: 18000,
        min: 25000,
      },
      {
        id: 'lowbed',
        name: 'Трал низкорамный 40 т',
        L: 13.0,
        W: 2.55,
        h: 3.1,
        hMax: 3.6,
        wMax: 3.5,
        t: 40,
        tLegal: 22,
        open: true,
        km: 110,
        kmFar: 90,
        base: 20000,
        min: 45000,
      },
    ],
    far: 1000, // граница участков тарифа, км: дальше — ставка kmFar
    overK: 1.1, // негабарит на площадке: надбавка к ставке (ставка трала уже рассчитана на негабарит)
    overKLowbed: 1,
    permit: 1600, // госпошлина за спецразрешение (НК РФ, ст. 333.33, п. 1, пп. 111), ₽ за машину
    permitAgent: 0, // оформление и проект маршрута через агента, ₽ (если пользуетесь)
    heavyFrom: 20, // тяжеловес для своих классов без «грузоподъёмности без спецразрешения»: груз тяжелее, т
    heavyPermit: 1600, // госпошлина за разрешение на тяжеловес, ₽
    harmKm: 74, // вред дорогам: ПП РФ от 01.12.2023 № 2060 — базовая величина 7 365 ₽ на 100 км × коэффициенты и индекс;
    // 74 ₽/км — ориентир, требует подтверждения (точно — по осевым нагрузкам и маршруту, в разрешении)
    escortW: 3.5, // шире — автомобили прикрытия (Требования Минтранса № 343, п. 14; число машин — Freight.escortCars)
    escortKm: 50, // один автомобиль прикрытия, ₽/км (ориентир — уточните у перевозчика)
    gibddW: 4.0, // шире — предупреждение о возможном сопровождении ГИБДД: решает Госавтоинспекция (№ 343, п. 30) — порог
    // требует подтверждения, стоимость — по договору, в расчёт не входит
    unload: [
      // разгрузка на объекте: максимальная масса одного места, т — стоимость смены (7 + 1 ч), ₽
      { id: 'manip', name: 'Манипулятор до 7 т', max: 7, cost: 15000 },
      { id: 'crane25', name: 'Автокран 25 т', max: 16, cost: 22000 },
      { id: 'crane50', name: 'Автокран 50 т', max: 32, cost: 40000 },
      { id: 'crane100', name: 'Автокран 100 т', max: 60, cost: 100000 },
    ],
    agentPct: 15, // агент-экспедитор: наценка к ставке перевозчика, % (рынок 5–15 %, в споте до 20–25 %)
    insPct: 0.15, // страхование груза по России — обязательно, % от стоимости груза (рынок 0,06–0,7 %, чаще 0,15 %)
    insMin: 300, // минимальная премия, ₽
    pack: 10, // упаковка (поддон, обрешётка), % к массе — для мест легче packMax
    packMax: 3, // тяжелее, т — оборудование на своей раме, без упаковки
    roadK: 1.13, // пока маршрут по дорогам не посчитан: коэффициент дорог (по дороге / по прямой), европейская часть
    roadKE: 1.22, // Урал и Сибирь (восточнее 59° в. д.)
    roadKFE: 1.4, // восточнее Байкала (105° в. д.): дороги в обход
    localKm: 40, // доставка в пределах города (адреса не уточнены)
    kmDay: 600, // пробег в сутки, км (негабарит — kmDayOver)
    kmDayOver: 350,
    permitDays: 5, // оформление спецразрешения, рабочих дней
    range: 15, // разброс оценки, ± %
    hub: 'Москва', // откуда везём импорт по умолчанию (СВХ / таможенный терминал)
    legal: { w: 2.55, h: 4.0 },
    sources: [
      'Ставки — с НДС 22 %, ставка перевозчика без агента; рейс = подача + км до 1 000 км × ставка + км дальше × «дальняя» ставка',
      'Москва → Санкт-Петербург, тент 20 т: 60 860 ₽ (калькулятор EastLines, 2026), от 70 000 ₽ (avtogost77.ru, июль 2026)',
      'Москва → Новосибирск, 20 т: 167 000 ₽ (фургон, EastLines), 188 104 ₽ (тент, базовый тариф «Русский Транзит 77»)',
      'Средние заказы Москва → Санкт-Петербург (maintransport.ru, 16.05.2026): Газель ≈ 35 000 ₽, 5 т ≈ 52 200 ₽, 10 т ≈ 66 700 ₽',
      'ATI.SU «Средние ставки», май 2026: фура — ≈ 58 ₽/км по рынку, ≈ 70 ₽/км средневзвешенно у перевозчиков; за 2025 год ставки выросли на 12,3 %',
      'Трал: до 30 т 80–120 ₽/км, 45–50 т 100–150 ₽/км, при 30 т ≈ 118 ₽/км; разрешение и сопровождение — отдельно (vityaz-tk.ru, rosperevozki.ru, 2026)',
      'Госпошлина за спецразрешение — 1 600 ₽ (НК РФ, ст. 333.33, п. 1, пп. 111; подтверждено: Росдормониторинг / «Автодор», russianhighways.ru, 19.10.2026); вред дорогам — ПП РФ от 01.12.2023 № 2060 (ставка ₽/км — ориентир, требует подтверждения); автомобили прикрытия — Требования Минтранса от 31.08.2020 № 343, п. 14 и 32 (legalacts.ru)',
      'Автокран 25 т — 18–22 тыс. ₽ за смену, 50 т — 32–44 тыс. ₽ (Москва, 2026)',
      'Агент-экспедитор: наценка 5–15 % от ставки перевозчика в массовом сегменте, в споте до 20–25 % (portal-logistic.ru, roolz.net, 2026)',
      'Страхование груза автотранспортом: 0,06–0,7 % от стоимости, обычно 0,15 %, полис от 300 ₽ (inslog.ru, infullbroker.ru, 2026)',
    ],
  };
  static NUM = ['L', 'W', 'h', 'hMax', 'wMax', 't', 'tLegal', 'km', 'kmFar', 'base', 'min', 'max', 'cost'];
  // прежние стандартные ставки и названия (одна ставка за км): сохранённые без изменений — заменяются новыми стандартными
  static OLD = {
    gazel: { name: '«Газель» тент 1,5 т', km: 30, base: 1500, min: 5000 },
    t5: { name: 'Грузовик 5 т', km: 40, base: 3000, min: 8000 },
    t10: { name: 'Грузовик 10 т', km: 45, base: 4000, min: 12000 },
    tent20: { name: 'Фура тент 20 т (82 м³)', km: 65, base: 6000, min: 20000 },
    flat: { name: 'Открытая площадка 20 т', km: 75, base: 8000, min: 25000 },
    lowbed: { name: 'Трал низкорамный 40 т', km: 120, base: 15000, min: 40000 },
  };
  // морской контейнер: 20 фут — 6,058 м, 40 фут — 12,192 м; ширина 2,438 м; высота 2,591 м (HC — 2,896 м)
  static ISO = { l: [6.058, 12.192], w: 2.438, h: [2.591, 2.896], tol: 0.04 };

  static FIXED = ['classes', 'unload', 'legal', 'sources', 'ver'];
  static LISTS = ['classes', 'unload'];
  static VER = 3;
  static FAR = 1000;

  /**
   * Тарифы: стандартные + сохранённые администратором + ставки автообновления (ATI.SU).
   * @param {object} [saved] сохранённое в «Настройках»
   * @returns {object}
   */
  static of(saved) {
    const tariffs = JSON.parse(JSON.stringify(this.DEFAULTS));
    if (saved && typeof saved === 'object') this._merge(tariffs, saved);
    this._auto(tariffs, saved);
    return tariffs;
  }

  static _merge(tariffs, saved) {
    for (const key of Object.keys(tariffs)) {
      if (this.FIXED.includes(key) || saved[key] == null || saved[key] === '') continue;
      tariffs[key] = typeof tariffs[key] === 'number' ? +saved[key] : saved[key];
    }
    const oldVer = !(+saved.ver >= this.VER);
    for (const key of this.LISTS) {
      if (!Array.isArray(saved[key]) || !saved[key].length) continue;
      const defs = tariffs[key];
      tariffs[key] = saved[key].map(row => this._row(key, row, defs, oldVer));
      // новые стандартные классы (контейнеровоз) — в тарифы, сохранённые до их появления
      if (key === 'classes' && oldVer) this._addNew(tariffs[key], defs);
    }
  }

  static _row(key, row, defs, oldVer) {
    const def = defs.find(item => item.id === row.id) || {};
    const own = { ...row };
    const old = key === 'classes' && oldVer && this.OLD[own.id];
    if (old) this._dropOld(own, old);
    const out = { ...def, ...own };
    for (const field of this.NUM) if (out[field] != null && out[field] !== '') out[field] = +out[field];
    // своя ставка из прежних версий (без «дальней» ставки) — та же по всему маршруту, как считалось раньше
    if (key === 'classes' && !(own.kmFar > 0) && own.km > 0) out.kmFar = +own.km;
    out.open = !!out.open;
    return out;
  }

  // прежние стандартные значения, не изменённые администратором, — новые стандартные (ставки 2026 в два участка)
  static _dropOld(own, old) {
    if (['km', 'base', 'min'].every(field => +own[field] === old[field])) {
      delete own.km;
      delete own.base;
      delete own.min;
      delete own.kmFar;
      if (own.src && /стандартн/.test(own.src)) delete own.src;
    }
    if (own.name === old.name) delete own.name;
  }

  static _addNew(list, defs) {
    for (const def of defs) if (!list.some(row => row.id === def.id) && !this.OLD[def.id]) list.push({ ...def });
  }

  // ставки из автообновления (ATI.SU) — у классов, где оно не выключено (auto:false — ставка закреплена вручную)
  static _auto(tariffs, saved) {
    const auto = saved && saved._auto;
    const byClass = (auto && auto.classes) || {};
    for (const cls of tariffs.classes) {
      const rate = byClass[cls.id];
      if (cls.auto !== false && rate && rate.km > 0) {
        Object.assign(cls, this.fromAuto(cls, rate, tariffs));
        Object.assign(cls, { src: rate.src, srcAt: auto.at, srcAuto: true });
      } else if (!cls.src) cls.src = this._src(saved);
    }
  }

  static _src(saved) {
    return saved && saved.updatedAt && Array.isArray(saved.classes)
      ? 'вручную в «Настройках»'
      : 'стандартная ставка (рынок 2026, см. источники)';
  }

  /**
   * Ставки класса по автообновлению: по направлениям с длиной и ценой рейса — ставка до far км и дальше (верхняя граница),
   * иначе — общая ставка ₽/км, а дальняя — в той же пропорции, что у стандартного тарифа.
   * @param {object} cls класс машины
   * @param {object} rate ставка автообновления
   * @param {object} tariffs
   * @returns {{km: number, kmFar: number}}
   */
  static fromAuto(cls, rate, tariffs) {
    const ratio = cls.kmFar > 0 && cls.km > 0 ? cls.kmFar / cls.km : 1;
    const far = tariffs.far > 0 ? tariffs.far : this.FAR;
    const base = cls.base || 0;
    const pts = (rate.routes || []).filter(route => route.dist > 0 && route.trip > 0);
    if (!pts.length) return { km: +rate.km, kmFar: Math.round(+rate.km * ratio) };
    const near = pts.filter(route => route.dist <= far);
    const long = pts.filter(route => route.dist > far);
    const perKm = near.length
      ? Math.max(...near.map(route => (route.trip - base) / route.dist))
      : Math.max(...long.map(route => (route.trip - base) / (far + ratio * (route.dist - far))));
    const nearKm = Math.max(1, perKm);
    let kmFar = long.length
      ? Math.max(...long.map(route => (route.trip - base - nearKm * far) / (route.dist - far)))
      : nearKm * ratio;
    if (!(kmFar > 0)) kmFar = nearKm * ratio;
    return { km: Math.round(nearKm), kmFar: Math.round(Math.min(kmFar, nearKm)) };
  }
}
