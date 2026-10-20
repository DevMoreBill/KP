/** Замечания одной станции без повторов; решение раздела — только к замечанию о нехватке. */
class FixList {
  constructor() {
    this.items = [];
    this.seen = new Set();
  }

  /**
   * Добавить замечание (повтор текста — пропускается).
   * @param {string} sec раздел
   * @param {boolean} bad ошибка (иначе предупреждение)
   * @param {string} text
   * @param {string} how как решить
   * @param {{id: string, label: string}|null} fix
   */
  add(sec, bad, text, how, fix) {
    const line = String(text || '').trim();
    if (!line || this.seen.has(line)) return;
    this.seen.add(line);
    this.items.push({ sec, bad: !!bad, text: line, how: how || '', fix: fix || null });
  }

  /**
   * Решение раздела («Нужно…», ресиверы по расчёту) — только к замечанию о нехватке (меньше нужного, нет аппарата).
   * @param {string} sec
   * @param {string|null} text
   * @returns {{id: string, label: string}|null}
   */
  sectionFix(sec, text) {
    if (text != null && !ExpertFix.SHORT.test(text)) return null;
    const found = this.items.find(item => item.sec === sec && item.fix && /^(need:|recv$)/.test(item.fix.id));
    return found ? found.fix : null;
  }

  /**
   * Есть ли замечания раздела.
   * @param {string} sec
   * @returns {boolean}
   */
  has(sec) {
    return this.items.some(item => item.sec === sec);
  }
}

/**
 * Режим «эксперт»: что в станции не выполняется — по разделам, с пояснением «как решить» и кнопкой «Решить автоматически»
 * (для всех станций: компрессорных, ДГУ, насосных). Источники: ошибки ввода, «Нужно…» по составу, расчёт станции,
 * замечания компоновки, значения «эксперта», заданные вручную. Что само не решается — с подсказкой менеджеру.
 */
export class ExpertFix {
  static SEC = {
    input: 'Ввод требований',
    main: 'Основное оборудование',
    air: 'Подготовка воздуха',
    recv: 'Ресиверы',
    fuel: 'Топливо ДГУ',
    fit: 'Контейнер и компоновка',
    gate: 'Ворота и двери',
    vent: 'Вентиляция и отопление',
    el: 'Электропитание',
    other: 'Прочее',
  };
  /** раздел расчёта (CalcNote) → раздел режима «эксперт» */
  static CALC = {
    air: 'main',
    press: 'main',
    dryer: 'air',
    filter: 'air',
    recv: 'recv',
    dgu: 'main',
    pump: 'main',
    el: 'el',
    vent: 'vent',
  };
  /** замечание компоновки → раздел (по тексту; первое совпадение) */
  static TEXT = [
    [/не подойти|не помещается|не проходит/i, 'fit'],
    [/жалюзи|вентиляц|выброс|приток|колпак|маркиз|отоплен|конвектор/i, 'vent'],
    [/ресивер/i, 'recv'],
    [/топлив|бак/i, 'fuel'],
    [/ворот|двер|выход/i, 'gate'],
    [/осушител|фильтр/i, 'air'],
    [/кабел|автомат|ввод|электр/i, 'el'],
    [/не помещается|не проходит|проход|контейнер|габарит|стоит в|промежутк|не подойти|над поз\.|высот|масс/i, 'fit'],
  ];
  /** как решить — по тексту замечания (первое совпадение); бак — с наибольшим объёмом из правил */
  static get HOW() {
    return [
      [
        /Топлив|бак/i,
        `Бак под время работы без дозаправки — «Решить» поставит нужный объём; больше ${Mm.text(StationMatrix.tank().max)} л — два бака или ёмкость вне контейнера.`,
      ],
      ...this.HOW_TEXT,
    ];
  }
  static HOW_TEXT = [
    [/в карточке не указан/i, 'Откройте позицию в каталоге и заполните эту характеристику — проверка выполнится.'],
    [
      /не подойти для обслуживания/i,
      'Нужен проход или сервисные ворота: возьмите контейнер больше или поменяйте порядок элементов в составе.',
    ],
    [
      /не помещается|не проходит по/i,
      'Возьмите контейнер больше или ресиверы по 500 л внутри (кнопка); не помещаются и они — ресиверы на площадку снаружи; иначе — оборудование меньших размеров или два модуля.',
    ],
    [/Контейнер с запасом/i, 'Возьмите меньший контейнер — дешевле и легче.'],
    [
      /Проход .*меньше рекомендуемых/i,
      'Допустимо по нормам; шире проход — в более широком контейнере (до 2 550 мм — без спецразрешения).',
    ],
    [/учёт\S* в Ростехнадзоре/i, 'Замените на несколько ресиверов по 900 л до 11 бар — каждый без учёта.'],
    [/Средняя нагрузка .* больше 70 %/i, 'ДГУ мощнее или по мощности COP — уточните у изготовителя.'],
    [/малой нагрузке|меньше \d+ % PRP/i, 'ДГУ меньшей мощности или уточните минимальную нагрузку у изготовителя.'],
    [
      /Пусковая мощность/i,
      'Укажите плавный пуск или частотный преобразователь («Условия для расчёта» → «Пуск этого двигателя») либо возьмите ДГУ больше.',
    ],
    [
      /Условия площадки|Условия выше номинальных/i,
      'Проверьте запас мощности по паспорту изготовителя при этих условиях.',
    ],
    [/NPSH|кавитац/i, 'Уменьшите высоту всасывания (подпор, насос ниже) или возьмите насос с меньшим NPSHr.'],
    [
      /циклограмм|пиков\S* разбор|проскок/i,
      'Проверьте циклограмму в блоке «Ресиверы»; мокрый ресивер до осушителя снимает пик.',
    ],
    [
      /объём .*ниже минимально|меньше нужного|кратн|500 л/i,
      'Число и типоразмер ресиверов — по расчёту («Решить» приведёт состав к расчёту).',
    ],
    [
      /номинал|клапан|рассчитан на|давлени/i,
      'Замените на исполнение на давление не ниже давления компрессора (у ресиверов — с запасом не меньше 1 бар).',
    ],
    [
      /меньше производительности|с поправк|меньше требуемой|меньше нагрузки|мощность ДГУ|меньше \S+ м³/i,
      'Добавьте ещё один такой же аппарат или замените на более мощный — «Решить» сделает это по каталогу.',
    ],
    [
      /Не поместилось .*жалюзи|приточных жалюзи|колпаков/i,
      'Включите «Вытяжные вентиляторы» (выброс через вентиляторы в стене напротив притока, приток до 4 м/с — проёмы меньше), освободите стену или возьмите контейнер больше; приточные вентиляторы программа ставит сама, если жалюзи не встают.',
    ],
    [/Над .* до потолка/i, 'Допустимо; больше места над оборудованием — в контейнере выше.'],
    [/Причина смещения|смещены/i, 'Укажите причину смещения или верните ворота на ось торца.'],
    [/фильтр/i, 'Добавьте фильтр нужной ступени — «Нужно…» в составе.'],
  ];
  static SHORT =
    /меньше|не хватает|нет (фильтр|осушител|ресивер|компрессор)|ниже минимал|не кратен|без обоснования|не помести/i;
  /** решение по виду: «clr:поле», «need:строка», «xs:раздел» — по началу до двоеточия */
  static FIXES = {
    clr: '_clear',
    need: '_needLine',
    recv: '_recvSync',
    cont: '_container',
    recvOut: '_recvOut',
    recv500: 'recv500',
    exfan: '_exfan',
    boost: '_boost',
    gate: '_gate',
    xs: '_expertReset',
  };
  static PASSES = 4;
  static memo = null;

  /**
   * Число из поля требований.
   * @param {*} value
   * @returns {number}
   */
  static num(value) {
    return StationReq.num(value);
  }

  /**
   * Раздел замечания по тексту.
   * @param {string} text
   * @returns {string}
   */
  static secOf(text) {
    const found = this.TEXT.find(([pattern]) => pattern.test(text));
    return found ? found[1] : 'other';
  }

  /**
   * Как решить — по тексту замечания.
   * @param {string} text
   * @returns {string}
   */
  static how(text) {
    const found = this.HOW.find(([pattern]) => pattern.test(text));
    return found ? found[1] : '';
  }

  /**
   * Решается без выбора менеджера («Решить всё»): не очищает его поля и не сбрасывает его значения «эксперта».
   * @param {string} id
   * @returns {boolean}
   */
  static auto(id) {
    return !/^(clr:|xs:|gate$)/.test(id);
  }

  /**
   * Все замечания станции [{sec, bad, text, how, fix}] по разделам в порядке проверки; в одной перерисовке окна список
   * считается один раз.
   * @param {object} item станция
   * @returns {object[]}
   */
  static list(item) {
    if (this.memo && this.memo.item === item) return this.memo.list;
    const list = this.collect(item);
    this.memo = { item, list };
    setTimeout(() => {
      this.memo = null;
    }, 0);
    return list;
  }

  /**
   * Замечания станции заново: ввод, состав, расчёт, компоновка, значения «эксперта».
   * @param {object} item
   * @returns {object[]}
   */
  static collect(item) {
    if (!Kit.station(item) || !Kit.has(item)) return [];
    const list = new FixList();
    this._inputs(item, list);
    this._needs(item, list);
    this._calc(item, list);
    this._layout(item, list);
    this._expert(item, list);
    return list.items;
  }

  static _inputs(item, list) {
    for (const error of ReqNum.errors(item))
      list.add(
        'input',
        true,
        `«${error.label}»: ${error.text}`,
        'Исправьте значение или очистите поле — расчёт возьмёт значение инженерных правил.',
        { id: `clr:${error.key}`, label: 'Очистить поле' },
      );
    const req = StationReq.of(item);
    if (this.num(req.gateOff) && !String(req.gateWhy || '').trim())
      list.add(
        'gate',
        true,
        'Ворота в торце смещены от оси без причины — КП не сохранится',
        'Укажите причину смещения («Ворота в торце — режим «эксперт»») или верните ворота на ось.',
        { id: 'gate', label: 'Вернуть на ось' },
      );
  }

  /** чего не хватает в составе («Нужно…»); ресиверы того же объёма — числом в той же строке состава */
  static _needs(item, list) {
    const sync = StationReq.kind(item) === 'comp' ? ReceiverSync.preview(item) : '';
    for (const need of KitNeed.recs(item)) {
      if (!(sync && /^receiver-(wet-)?more$/.test(need.key))) this._need(item, list, need);
    }
    if (sync)
      list.add(
        'recv',
        false,
        `Число ресиверов в составе — не по расчёту: нужно ${sync}`,
        'Число приводится к расчёту по методике (объём по ТЗ, циклограмма, пик точки).',
        { id: 'recv', label: 'Пересчитать' },
      );
  }

  static _need(item, list, need) {
    const can = KitNeed.can(item, need);
    const why = need.why ? `${need.why[0].toUpperCase()}${need.why.slice(1)}.` : '';
    list.add(
      this._needSec(need),
      need.swap,
      KitNeed.head(need),
      why + (can ? '' : ' В каталоге подходящего нет — добавьте позицию в каталог.'),
      can ? { id: `need:${need.key}`, label: this._needLabel(need) } : null,
    );
  }

  static _needSec(need) {
    if (need.main || /^main/.test(need.key || '')) return 'main';
    if (need.cat === 'receiver') return 'recv';
    if (need.key === 'tank') return 'fuel';
    return /^(dryer|filter)/.test(need.cat || '') ? 'air' : 'other';
  }

  static _needLabel(need) {
    if (need.swap) return 'Заменить';
    return need.act ? 'Добавить' : 'Подобрать';
  }

  /** расчёт станции (ошибки ввода — выше) и вопросы заказчику */
  static _calc(item, list) {
    const calc = StationRules.ok() && typeof StationCalc !== 'undefined' ? StationCalc.run(item) : null;
    if (!calc) return;
    for (const issue of calc.issues.filter(row => row.level !== 'info' && !/^Требования: «/.test(row.text))) {
      const sec = /топлив|бак/i.test(issue.text) ? 'fuel' : this.CALC[issue.sec] || this.secOf(issue.text);
      list.add(sec, issue.level === 'error', issue.text, this.how(issue.text), list.sectionFix(sec, issue.text));
    }
    for (const question of calc.questions)
      list.add(
        'input',
        false,
        `Нужно узнать у заказчика: ${question}`,
        'Спросите заказчика и укажите ответ в «Подборе станции» — расчёт уточнится.',
        null,
      );
  }

  /** замечания компоновки (ошибки и предупреждения) */
  static _layout(item, list) {
    const plan = StationUi.enabled(item) && Kit.container(item) ? StationUi.plan(item) : null;
    if (!plan || plan.level === 'none') return;
    for (const issue of plan.issues || []) {
      if (issue.level === 'error' || issue.level === 'warn') {
        const sec = issue.big ? 'fit' : this.secOf(issue.text);
        const fix = this._layoutFix(item, { issue, sec, plan, list });
        list.add(sec, issue.level === 'error', issue.text, this.how(issue.text), fix);
      }
    }
  }

  /**
   * Не помещается: другой контейнер; затем ресиверы по 500 л внутри (без учёта в Ростехнадзоре); затем ресиверы после
   * осушителя снаружи (ФНП ОРПД, п. 65); жалюзи не встают — вентиляторы.
   */
  static _layoutFix(item, { issue, sec, plan, list }) {
    const suggest = plan.suggest;
    if (suggest && sec === 'fit' && (issue.level === 'error' || issue.big))
      return { id: 'cont', label: `${suggest.smaller ? 'Взять меньше: ' : 'Взять: '}${this.cont(suggest)}` };
    const outside = this._canMoveOut(item, issue, sec);
    if (outside && this._canShrink(item)) return { id: 'recv500', label: 'Ресиверы по 500 л — внутри' };
    if (outside) return { id: 'recvOut', label: 'Ресиверы после осушителя — снаружи' };
    return this._ventFix(item, issue, sec) || list.sectionFix(sec, issue.text);
  }

  static _canMoveOut(item, issue, sec) {
    return (
      StationReq.kind(item) === 'comp' &&
      issue.level === 'error' &&
      sec === 'fit' &&
      !StationReq.recvOut(item) &&
      Kit.parts(item).some(part => StationEquip.kindOf(part) === 'receiver')
    );
  }

  static _canShrink(item) {
    return !StationReq.of(item).recvSize && this._mainReceivers(item).length > 0;
  }

  static _ventFix(item, issue, sec) {
    const container = Kit.container(item);
    if (sec !== 'vent' || !/Не поместил/.test(issue.text) || !container) return null;
    if (!KitView.sysOn(item, container, 'exfan') && StationRules.opt('vent.exfan'))
      return { id: 'exfan', label: 'Включить вытяжные вентиляторы' };
    if (!KitView.sysOn(item, container, 'boost'))
      return { id: 'boost', label: 'Включить вентилятор в воздуховоде выброса' };
    return null;
  }

  /** значения «эксперта», заданные вручную, — если в их разделе есть замечания */
  static _expert(item, list) {
    const req = StationReq.of(item);
    for (const [sec, keys] of [
      ['vent', ExpertLog.VENT()],
      ['gate', ExpertLog.GATE],
    ]) {
      const own = keys.filter(key => ExpertLog.set(req, key));
      if (own.length && list.has(sec))
        list.add(
          sec,
          false,
          `Заданы вручную (режим «эксперт»): ${own.map(key => ExpertLog.label(key)).join(', ')}`,
          'Если замечания из-за них — верните значения инженерных правил.',
          { id: `xs:${sec}`, label: 'Всё по правилам' },
        );
    }
  }

  /** основные ресиверы (не мокрые и не у потребителя) больше 500 л */
  static _mainReceivers(item) {
    return Kit.parts(item).filter(
      part =>
        StationEquip.kindOf(part) === 'receiver' &&
        part.recvRole !== 'wet' &&
        part.recvRole !== 'local' &&
        AirChain.volume(part) > ReceiverPlan.SMALL,
    );
  }

  /**
   * Контейнер словами: «Блок-контейнер 7 000 × 2 550 × 2 800 мм».
   * @param {object} suggest
   * @returns {string}
   */
  static cont(suggest) {
    const size = suggest.size ? ` ${suggest.size.map(side => Mm.text(side)).join(' × ')} мм` : '';
    return ContainerKind.of(suggest.ctype).name + size;
  }

  /**
   * Решить одно замечание.
   * @param {object} item
   * @param {string} id
   * @returns {Promise<string>} что сделано ('' — не получилось)
   */
  static async fix(item, id) {
    this.memo = null;
    try {
      return await this._fixOne(item, id);
    } finally {
      this.memo = null;
    }
  }

  static async _fixOne(item, id) {
    StationReq.ensure(item);
    const colon = id.indexOf(':');
    const kind = colon < 0 ? id : id.slice(0, colon);
    const method = this.FIXES[kind];
    return method ? this[method](item, colon < 0 ? '' : id.slice(colon + 1)) : '';
  }

  static _clear(item, key) {
    if (!(key in ReqNum.RANGE)) return '';
    delete StationReq.ensure(item)[key];
    return `поле «${ReqNum.LABEL[key] || key}» очищено`;
  }

  static _needLine(item, key) {
    const need = KitNeed.recs(item).find(row => row.key === key);
    return need ? this.need(item, need) : '';
  }

  static _recvSync(item) {
    const text = ReceiverSync.apply(item);
    return text ? `ресиверы: ${text}` : '';
  }

  static _container(item) {
    const container = Kit.container(item);
    const plan = StationUi.plan(item);
    const suggest = plan && plan.suggest;
    if (!suggest || !container) return '';
    ContainerPart.apply(container, {
      ctype: suggest.ctype,
      size: suggest.size ? suggest.size.join(' × ') : '',
      sizeAuto: !!StationGeo.FLEX[suggest.ctype],
    });
    return `контейнер — ${this.cont(suggest)}`;
  }

  static _recvOut(item) {
    StationReq.ensure(item).recvOut = true;
    return 'ресиверы после осушителя — снаружи на площадке у торца (ФНП ОРПД, п. 65)';
  }

  static _exfan(item) {
    const container = Kit.container(item);
    if (!container) return '';
    container.sys = { ...(container.sys || ContainerKind.SYSTEMS_ON), exfan: true, boost: false };
    ContainerPart.apply(container);
    return 'вытяжные вентиляторы в стене напротив притока — проёмы меньше';
  }

  static _boost(item) {
    const container = Kit.container(item);
    if (!container) return '';
    container.sys = { ...(container.sys || ContainerKind.SYSTEMS_ON), boost: true };
    ContainerPart.apply(container);
    return 'вентилятор в воздуховоде выброса — жалюзи меньше';
  }

  static _gate(item) {
    ExpertLog.reset(item, ExpertLog.GATE);
    return 'ворота — по оси торца';
  }

  static _expertReset(item, sec) {
    ExpertLog.reset(item, sec === 'vent' ? ExpertLog.VENT() : ExpertLog.GATE);
    return 'значения — по инженерным правилам';
  }

  /**
   * Основные ресиверы — по 500 л (нехватка места): число — по расчёту, ресивер — рекомендуемый из каталога; 500 л в
   * каталоге нет — ничего не меняется ('').
   * @param {object} item
   * @returns {Promise<string>}
   */
  static async recv500(item) {
    const req = StationReq.ensure(item);
    const old = this._mainReceivers(item);
    if (!old.length) return '';
    const keep = { recvSize: req.recvSize, recvWhy: req.recvWhy };
    req.recvSize = '500';
    req.recvWhy = 'space';
    StationSup.use(item);
    const plan = StationReq.recvPlan(item);
    const offer = plan && plan.main ? TzPick.recvPick(ReceiverPlan.SMALL, KitNeed.bar(item), TzPick.hmax(item)) : null;
    if (!offer || !offer.o) {
      this._restore(req, keep);
      return '';
    }
    const part = await TzPick.part(offer.o.c, plan.main.n);
    part.recvRole = 'dry';
    const place = item.kit.parts.indexOf(old[0]);
    item.kit.parts = item.kit.parts.filter(row => !old.includes(row));
    item.kit.parts.splice(Math.max(0, Math.min(place, item.kit.parts.length)), 0, part);
    return `ресиверы — ${plan.main.n} × ${offer.o.c.name} внутри (500 л, без учёта в Ростехнадзоре: нехватка места)`;
  }

  static _restore(req, keep) {
    for (const [key, value] of Object.entries(keep)) {
      if (value) req[key] = value;
      else delete req[key];
    }
  }

  /**
   * Строка «Нужно…» без окна каталога: число и бак — в составе, остальное — рекомендуемый; основное — по требованиям.
   * @param {object} item
   * @param {object} need
   * @returns {Promise<string>}
   */
  static async need(item, need) {
    if (need.act) return KitNeed.apply(item, need);
    const best = need.main ? this._mainBest(item) : KitNeed.best(item, need);
    if (!best || !best.c) return '';
    item.kit = item.kit || { parts: [] };
    if (Array.isArray(need.replace)) item.kit.parts = item.kit.parts.filter(part => !need.replace.includes(part.id));
    const part = await TzPick.part(best.c, best.n, need.main ? 'main' : '');
    this._place(item, part, need, best);
    return `${best.n > 1 ? `${best.n} × ` : ''}${best.c.name}`;
  }

  /** ступень фильтра и роль ресивера; основное — перед контейнером, остальное — в конец состава */
  static _place(item, part, need, best) {
    if (need.cat === 'filter' && AirChain.GRADES[need.key]) part.airGrade = need.key;
    if (best.role) part.recvRole = best.role;
    if (need.main) this._insertMain(item, part);
    else item.kit.parts.push(part);
  }

  static _mainBest(item) {
    const preset = KitNeed.mainPreset(item);
    const card = preset && preset.best ? catCache.find(row => row.id === preset.best.id) : null;
    return card ? { c: card, n: preset.best.n } : null;
  }

  static _insertMain(item, part) {
    const place = item.kit.parts.findIndex(row => row.role === 'container');
    item.kit.parts.splice(place >= 0 ? place : 0, 0, part);
  }

  /**
   * «Решить автоматически»: всё, что решается без выбора менеджера, — по порядку, до PASSES проходов (после замены могут
   * появиться новые «Нужно…»).
   * @param {object} item
   * @param {string[]|null} sections
   * @returns {Promise<string[]>} что сделано
   */
  static async all(item, sections) {
    const done = [];
    const tried = new Set();
    for (let pass = 0; pass < this.PASSES; pass++) {
      const fixes = this.list(item).filter(
        row => row.fix && this.auto(row.fix.id) && !tried.has(row.fix.id) && (!sections || sections.includes(row.sec)),
      );
      if (!fixes.length) break;
      for (const row of fixes) await this._autoFix(item, row, tried, done);
    }
    return done;
  }

  static async _autoFix(item, row, tried, done) {
    if (tried.has(row.fix.id)) return;
    tried.add(row.fix.id);
    const text = await this.fix(item, row.fix.id);
    if (text) done.push(text);
    Kit.sync(item);
    StationUi.cache.delete(item.id);
    StationSize.refresh(item);
    this.memo = null;
  }

  /**
   * Замечания разделов sections (null — все): текст, «как решить», кнопка.
   * @param {object} item
   * @param {number} index
   * @param {string[]|null} sections
   * @param {{title?: string, all?: boolean, max?: number, skip?: string}} [opts] заголовок, «Решить автоматически»,
   *   не больше строк, текст уже в строке итога
   * @returns {string}
   */
  static html(item, index, sections, opts = {}) {
    const all = this.list(item).filter(row => !sections || sections.includes(row.sec));
    const shown = all.filter(row => row.text !== opts.skip);
    const autos = all.filter(row => row.fix && this.auto(row.fix.id)).length;
    if (!shown.length && !(opts.all && autos)) return '';
    const list = shown.length ? this._list(index, sections, opts, shown) : '';
    return `<div class="xf">${this._head(index, sections, opts, autos)}
      ${list}</div>`;
  }

  static _head(index, sections, opts, autos) {
    const button = opts.all && autos;
    if (!opts.title && !button) return '';
    const title = opts.title ? `<b>${esc(opts.title)}</b>` : '';
    const fixAll = button
      ? `<button class="btn primary sm" type="button" data-a="xFixAll" data-i="${index}" data-k="${esc(sections ? sections.join(',') : '')}">Решить автоматически${autos > 1 ? ` (${autos})` : ''}</button>`
      : '';
    return `<div class="xf-h">${title}${fixAll}</div>`;
  }

  static _list(index, sections, opts, shown) {
    const max = opts.max || shown.length;
    const more = shown.length - max;
    const tag = !sections || sections.length > 1;
    const rows = shown
      .slice(0, max)
      .map(row => this._row(index, row, tag))
      .join('');
    return `<ul class="xf-l">${rows}
        ${more > 0 ? `<li class="muted">и ещё ${more} — в разделах «Все требования, условия расчёта и проверки»</li>` : ''}</ul>`;
  }

  static _row(index, row, tag) {
    const sec = tag ? ` <span class="xf-s">${esc(this.SEC[row.sec] || '')}</span>` : '';
    return `<li class="${row.bad ? 'bad' : 'warn'}"><div class="xf-t">${row.bad ? '✕' : '⚠'} ${esc(row.text)}${sec}</div>
        ${row.how || row.fix ? this._howLine(index, row) : ''}</li>`;
  }

  static _howLine(index, row) {
    const how = row.how ? `<small class="muted">Как решить: ${esc(row.how)}</small>` : '';
    return `<div class="xf-a">${how}${this.button(index, row)}</div>`;
  }

  /**
   * Кнопка решения замечания или ''.
   * @param {number} index
   * @param {object} row
   * @returns {string}
   */
  static button(index, row) {
    if (!row || !row.fix) return '';
    return `<button class="btn sm${this.auto(row.fix.id) ? '' : ' ghost'}" type="button" data-a="xFix" data-i="${index}" data-k="${esc(row.fix.id)}">${esc(row.fix.label)}</button>`;
  }

  /**
   * «Как решить» и кнопка для замечания с этим текстом (строка итога «Подбора станции») или ''.
   * @param {object} item
   * @param {number} index
   * @param {string} text
   * @returns {string}
   */
  static hint(item, index, text) {
    const row = this.list(item).find(fix => fix.text === String(text || '').trim());
    return row && (row.how || row.fix) ? this._howLine(index, row) : '';
  }

  /**
   * Есть ли замечания в разделах (раскрыть раздел).
   * @param {object} item
   * @param {string[]} sections
   * @returns {boolean}
   */
  static has(item, sections) {
    return this.list(item).some(row => sections.includes(row.sec));
  }

  /**
   * Кнопка «Решить» для замечания с этим текстом (вкладка «Компоновка») или ''.
   * @param {object} item
   * @param {number} index
   * @param {string} text
   * @param {object[]} [list] замечания, если уже собраны
   * @returns {string}
   */
  static btn(item, index, text, list) {
    const row = (list || this.list(item)).find(fix => fix.text === String(text || '').trim() && fix.fix);
    if (!row) return '';
    return `<button class="lnk is-fix" type="button" data-a="xFix" data-i="${index}" data-k="${esc(row.fix.id)}" title="${esc(row.how || '')}">${esc(row.fix.label.toLowerCase())}</button>`;
  }

  /**
   * Действия: xFix — одно замечание, xFixAll — всё, что решается автоматически.
   * @param {string} action
   * @param {number} index
   * @param {HTMLElement} button
   */
  static async act(action, index, button) {
    const item = S.items[index];
    if (!item) return;
    if (action === 'xFix') await this._actOne(item, String(button.dataset.k || ''));
    if (action === 'xFixAll')
      await this._actAll(
        item,
        String(button.dataset.k || '')
          .split(',')
          .filter(Boolean),
      );
  }

  static async _actOne(item, id) {
    if (!this.auto(id) && id !== 'gate' && !confirm('Сбросить заданное вручную?')) return;
    const text = await this.fix(item, id);
    KitNeed.done(item);
    StationImages.soon(item);
    toast(text ? `Сделано: ${text}` : 'Автоматически не решается — смотрите «Как решить»');
  }

  static async _actAll(item, sections) {
    const done = await this.all(item, sections.length ? sections : null);
    KitNeed.done(item);
    StationImages.soon(item);
    const left = this.list(item).filter(row => row.bad).length;
    toast(
      (done.length ? `Сделано: ${done.join('; ')}` : 'Автоматически решить нечего') +
        (left ? `. Осталось ошибок: ${left} — смотрите «Как решить»` : ''),
    );
  }
}
