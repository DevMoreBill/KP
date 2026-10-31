import { StationImages } from './station-images.js';
import { ItemEditor } from '../catalog/item-editor.js';
import { Toast } from '../../core/toast.js';
import { KpState, S } from '../../core/state.js';
import { StationView3D } from '../draw/station-view3d.js';
import { StationRender } from '../view/station-render.js';
import { Mm } from '../layout/mm.js';
import { StationEquip } from '../layout/station-equip.js';
import { StationCalc } from '../calc/station-calc.js';
import { StationRules } from '../rules/station-rules.js';
import { ExpertFix } from './expert-fix.js';
import { KitNeed } from '../kit/kit-need.js';
import { AirChain } from '../layout/air-chain.js';
import { StationUi } from './station-ui.js';
import { ReqNum } from '../req/req-num.js';
import { esc } from '../../core/util.js';
import { StationReq } from '../req/station-req.js';
import { StationSteps } from './station-steps.js';
import { KpForm } from '../../core/kp-form.js';
import { Spoiler } from '../../core/spoiler.js';
import { StationParams } from '../kit/station-params.js';
import { Kit } from '../../core/kit.js';
import { ContainerKind } from '../layout/container-kind.js';
import { StationPlan } from '../req/station-plan.js';
import { ReqForm } from './req-form.js';
import { TzPick } from '../kit/tz-pick.js';
import { StationSup } from '../kit/station-sup.js';

/**
 * Станция «просто» — главный экран менеджера на вкладке «Состав станции»: главные требования (или ТЗ заказчика) и одна
 * кнопка «Подобрать оборудование» — оборудование из каталога, контейнер, компоновка и изображения для КП. Итог — одной
 * строкой, состав коротко, проверки значками, 3D-вид; подробности — под раскрывающимися блоками.
 */
export class StationQuick {
  /** главные поля по виду станции: [ключ, подпись, подсказка, режим ввода] */
  static KEYS = {
    comp: [
      ['flow', 'Производительность, м³/мин', 'например, 10'],
      ['pressure', 'Давление у потребителя, бар', 'например, 7'],
    ],
    dgu: [
      ['kw', 'Мощность нагрузки, кВт', 'например, 200'],
      ['hours', 'Работа без дозаправки, ч', 'например, 8', 'numeric'],
    ],
    pump: [
      ['q', 'Подача, м³/ч', 'например, 50'],
      ['head', 'Напор, м', 'например, 40'],
    ],
  };
  /** без чего подбор невозможен */
  static NEED = { comp: ['flow', 'производительность'], dgu: ['kw', 'мощность нагрузки'], pump: ['q', 'подачу'] };
  /** в каких кубометрах производительность в ТЗ — коротко (полные подписи — StationReq.BASIS) */
  static BASIS = [
    ['fad', 'м³/мин на выходе (FAD, как в каталогах)'],
    ['normal', 'нормальные н. м³/мин (0 °C)'],
    ['std', 'стандартные ст. м³/мин (20 °C)'],
  ];
  static SEC = {
    air: 'Производительность',
    press: 'Давление',
    dryer: 'Осушитель',
    filter: 'Фильтры',
    recv: 'Ресиверы',
    dgu: 'ДГУ',
    pump: 'Насосы',
    el: 'Электропитание',
    vent: 'Вентиляция',
  };
  static WHO = { comp: 'компрессоров', dgu: 'мощности ДГУ', pump: 'насосов' };
  static WORDS = {
    compressor: 'компрессоры',
    dryer: 'осушитель',
    filter: 'фильтры',
    receiver: 'ресиверы',
    dgu: 'ДГУ',
    pump: 'насосы',
  };
  /** что заменится при подборе заново (по виду станции) */
  static REPICK = { comp: 'Компрессоры, осушители, фильтры и ресиверы', dgu: 'ДГУ и бак', pump: 'Насосы' };
  static CHANGED = { flow: 'производительность', pressure: 'давление', kw: 'мощность', q: 'подача', head: 'напор' };
  static AUTO = ['flow', 'pressure', 'kw', 'q', 'head'];
  static MAIN = /^(compressor|dgu|pump)$/;
  static PICKED = /^(compressor|dryer|filter|receiver|dgu|pump)$/;
  static MISSING = /В каталоге нет: ([^]*?)(?: — добавьте вручную|$)/;
  static MARK = /^[✕⚠ⓘ✓] /;
  static NOTE_MAX = 900;
  static FIX_MAX = 6;
  static FEW_STAGES = 5;
  static TOAST_LONG = 9000;
  static busy = new Set();

  /**
   * Блок «Подбор станции»: главные требования, кнопки, итог; остальное — в раскрывающемся блоке.
   * @param {object} item станция
   * @param {number} index номер позиции КП
   * @returns {string}
   */
  static html(item, index) {
    const req = StationReq.of(item);
    const kind = StationReq.kind(item);
    const main = Kit.main(item);
    const view = { item, index, req, hint: this.hint(item), ask: this.ask(item) ? (this.NEED[kind] || [])[0] : '' };
    const fields = (this.KEYS[kind] || []).map(field => this._field(view, field)).join('');
    const industry =
      kind === 'comp'
        ? this._select(index, ['industry', 'Отрасль заказчика', StationReq.INDUSTRY, req.industry || ''])
        : '';
    const busy = this.busy.has(item.id);
    const state = main ? this._state(item) : null;
    return `<div class="sq">
      <div class="sq-h"><b>Подбор станции</b><span class="muted">Главное — ниже; остальное программа подберёт сама: оборудование из каталога, контейнер, компоновку и изображения для КП.</span></div>
      ${this._steps(item, kind, state)}
      <div class="sq-g">${fields}${this._kindFields(item, index, kind)}${this._select(index, ['reserve', 'Резерв', StationReq.RES, req.reserve || ''])}${industry}</div>
      ${this._oil(index, kind, req)}
      <div class="sq-a"><button class="btn primary" type="button" data-sq="pick" data-i="${index}"${busy ? ' disabled' : ''}>${this._pickLabel(busy, main)}</button>
        ${`<button class="btn ghost" type="button" data-a="tzLoad" data-i="${index}">ТЗ заказчика: файл или текст</button>`}
        ${req.src && req.src.name ? `<span class="muted">по ТЗ «${esc(req.src.name)}»</span>` : ''}</div>
      ${StationParams.html(item, index)}
      ${state ? this.result(item, index, state) : ''}
      <details class="sq-more"${Spoiler.attr(`req:${item.id}`)}><summary>Все требования, условия расчёта и проверки</summary>${ReqForm.html(item, index)}</details></div>`;
  }

  static _steps(item, kind, state) {
    const status = state ? this._status(item, state)[0] : '';
    return StationSteps.html(item, { need: (this.NEED[kind] || [])[0], status });
  }

  static _pickLabel(busy, main) {
    if (busy) return 'Подбираю…';
    return main ? 'Подобрать заново' : 'Подобрать оборудование';
  }

  static _field(view, [key, label, placeholder, mode = 'decimal']) {
    const mark = ReqNum.mark(view.item, key);
    const value = esc(view.req[key] ?? '');
    const hint = esc(view.hint[key] || placeholder);
    return `<label class="f"><span>${label}</span><input type="text" inputmode="${mode}" data-p="items.${view.index}.req.${key}" data-req="${view.index}" value="${value}" placeholder="${hint}" autocomplete="off"${this._fieldClass(mark, key, view.ask)}>${mark.msg}</label>`;
  }

  static _fieldClass(mark, key, ask) {
    if (mark.cls) return ' class="bad"';
    return key === ask ? ' class="need"' : '';
  }

  static _select(index, [key, label, list, current]) {
    const options = list
      .map(
        ([value, text]) =>
          `<option value="${esc(value)}"${String(current) === String(value) ? ' selected' : ''}>${esc(text)}</option>`,
      )
      .join('');
    return `<label class="f"><span>${label}</span><select data-req="${index}" data-rk="${key}">${options}</select></label>`;
  }

  /** поля вида станции: компрессорная — в каких кубометрах и качество воздуха, ДГУ — назначение */
  static _kindFields(item, index, kind) {
    const req = StationReq.of(item);
    if (kind === 'dgu') return this._select(index, ['mode', 'Назначение', StationReq.MODE, req.mode || 'prime']);
    if (kind !== 'comp') return '';
    const quality = StationPlan.opts(item).air;
    const options = AirChain.options(quality)
      .map(
        ([value, text]) => `<option value="${esc(value)}"${quality === value ? ' selected' : ''}>${esc(text)}</option>`,
      )
      .join('');
    return `${this._select(index, ['basis', 'Производительность — это', this.BASIS, req.basis || 'fad'])}<label class="f"><span>Качество воздуха</span><select data-stl="air" data-i="${index}"><option value="">обычное — осушитель и фильтры по умолчанию</option>${options}</select></label>`;
  }

  /** пищевая и медицинская промышленность — только безмасляные; масляный — по требованию заказчика */
  static _oil(index, kind, req) {
    const word = StationReq.INDUSTRY_WORD[req.industry];
    if (kind !== 'comp' || !word) return '';
    const text = req.oilOk
      ? 'Масляный компрессор допущен по требованию заказчика.'
      : `Компрессоры — только безмасляные (класс 0 по маслу): правило для ${esc(word)} промышленности.`;
    return `<p class="sq-oil"><span class="${req.oilOk ? 'muted' : ''}">${text}</span>
        <label class="chk"><input type="checkbox" data-req="${index}" data-rk="oilOk"${req.oilOk ? ' checked' : ''}> масляный — по требованию заказчика</label></p>`;
  }

  /**
   * Главное требование не указано, а основное оборудование выбрано: «Укажите производительность по ТЗ — проверим, хватает
   * ли компрессоров»; иначе ''.
   * @param {object} item
   * @returns {string}
   */
  static ask(item) {
    const kind = StationReq.kind(item);
    const need = this.NEED[kind];
    if (!need || !Kit.main(item) || StationReq.num(StationReq.of(item)[need[0]]) > 0) return '';
    return `Укажите ${need[1]} по ТЗ — проверим, хватает ли ${this.WHO[kind]}`;
  }

  /**
   * Подсказка в пустых полях компрессорной: что дают выбранные компрессоры.
   * @param {object} item
   * @returns {object} ключ поля → текст подсказки
   */
  static hint(item) {
    const comps = StationReq.kind(item) === 'comp' ? KitNeed.comps(item) : [];
    const flow = comps.reduce((sum, comp) => sum + (comp.air.flow > 0 ? comp.air.flow * comp.qty : 0), 0);
    const bar = KitNeed.bar(item);
    return {
      ...(flow > 0 ? { flow: `по компрессорам: ${AirChain.flowText(flow)}` } : {}),
      ...(bar > 0 ? { pressure: `компрессоры: до ${AirChain.flowText(bar)}` } : {}),
    };
  }

  /**
   * Итог подбора: статус одной строкой, что подобрано, проверки значками, 3D-вид.
   * @param {object} item
   * @param {number} index
   * @param {object} [state] компоновка и расчёт, если уже посчитаны
   * @returns {string}
   */
  static result(item, index, state = this._state(item)) {
    const [cls, title] = this._status(item, state);
    const text = title.replace(this.MARK, '');
    const fixes = ExpertFix.html(item, index, null, { all: true, max: this.FIX_MAX, skip: text });
    return `<div class="sq-r">
      <div class="sq-st ${cls}"><b>${esc(title)}</b>${this._advice(item, index, state, text)}</div>
      ${fixes}
      <div class="sq-b"><div class="sq-l">${this.lines(item)
        .map(line => `<div>${esc(line)}</div>`)
        .join('')}${this._containerLine(item)}${this._supLine(item)}
        ${this._chips(state.calc)}</div>${this.pic(item, state.plan)}</div></div>`;
  }

  /** компоновка, расчёт и чего нет в каталоге — для итога */
  static _state(item) {
    const plan = StationPlan.enabled(item) && Kit.container(item) ? StationPlan.plan(item) : null;
    const calc = StationRules.ok() ? StationCalc.run(item) : null;
    return {
      plan,
      calc,
      errors: calc && !calc.accept ? calc.errors : [],
      fit: plan && plan.level === 'error' && !plan.assumed,
      miss: String(StationReq.of(item).pick || '').match(this.MISSING),
    };
  }

  /**
   * Причина — первой: не помещается; в каталоге нет нужного; ошибка расчёта; главное требование не указано (спокойная
   * подсказка); нет данных; замечания компоновки.
   */
  static _status(item, { fit, miss, errors, calc }) {
    if (fit) return ['bad', '✕ Оборудование не помещается в контейнер'];
    if (miss)
      return [errors.length ? 'bad' : 'warn', `${errors.length ? '✕' : '⚠'} В каталоге не нашлось: ${miss[1]}`];
    if (errors.length) return ['bad', `✕ ${errors[0].text}${errors.length > 1 ? ` (и ещё ${errors.length - 1})` : ''}`];
    const ask = this.ask(item);
    if (ask) return ['info', `ⓘ ${ask}`];
    if (calc && calc.questions.length) return ['warn', `⚠ Не хватает данных: ${calc.questions[0]}`];
    return this._fixStatus(ExpertFix.list(item));
  }

  static _fixStatus(list) {
    const bad = list.find(fix => fix.bad);
    const warn = list.filter(fix => !fix.bad).length;
    if (bad) return ['bad', `✕ ${bad.text}`];
    if (warn) return ['warn', `⚠ Станция подобрана — есть замечания (${warn}): посмотрите ниже`];
    return ['ok', '✓ Станция подобрана — требования заказчика выполнены'];
  }

  /** как решить: другой контейнер, решение эксперта или подсказка */
  static _advice(item, index, { plan, fit, miss, errors }, text) {
    if (fit && plan.suggest) return StationUi.fix(plan.suggest, index);
    const hint = ExpertFix.hint(item, index, text);
    if (hint) return hint;
    if (!fit && miss)
      return '<span class="muted">Добавьте позицию в каталог или выберите аналог в составе ниже; затем — «Подобрать заново».</span>';
    if (errors.length && !fit)
      return '<span class="muted">Замените оборудование в составе ниже или нажмите «Подобрать заново»; подробно — на вкладке «Компоновка».</span>';
    return '';
  }

  /** проверки расчёта значками по разделам */
  static _chips(calc) {
    if (!calc) return '';
    const chips = calc.sections.map(section => this._chip(section)).join('');
    return chips ? `<div class="sq-ck">${chips}</div>` : '';
  }

  static _chip(section) {
    const steps = section.steps.filter(step => step.ok === true || step.ok === false);
    if (!steps.length) return '';
    const bad = steps.some(step => step.ok === false);
    return `<button type="button" class="chip sm ${bad ? 'bad' : 'ok'}" data-edtab="layout" title="Подробный расчёт — вкладка «Компоновка»">${bad ? '✕' : '✓'} ${esc(this.SEC[section.id] || section.title)}</button>`;
  }

  static _containerLine(item) {
    const container = Kit.container(item);
    if (!container) return '';
    const size = String(container.size || '').trim() ? `, ${container.size} мм` : '';
    return `<div class="muted">${esc(ContainerKind.of(container.ctype).name + size)}</div>`;
  }

  static _supLine(item) {
    const summary = StationSup.summary(item);
    return summary ? `<div class="muted sq-sup">${esc(summary)}</div>` : '';
  }

  /**
   * Состав коротко: основное оборудование (рабочих + резерв), подготовка воздуха, ресиверы, баки.
   * @param {object} item
   * @returns {string[]}
   */
  static lines(item) {
    const parts = Kit.parts(item).filter(part => part.role !== 'container');
    const reserve = Math.max(0, Math.round(StationReq.num(StationReq.of(item).reserve) || 0));
    const kinds = [
      ['compressor', ''],
      ['dgu', ''],
      ['pump', ''],
      ['dryer', ''],
      ['filter', 'Фильтры'],
      ['receiver', 'Ресиверы'],
      ['tank', 'Топливный бак'],
    ];
    return kinds.flatMap(([kind, title]) => {
      const list = parts.filter(part => StationEquip.kindOf(part) === kind);
      return list.length ? this._kindLines(kind, title, list, reserve) : [];
    });
  }

  static _kindLines(kind, title, list, reserve) {
    const count = list.reduce((sum, part) => sum + Math.max(1, +part.qty || 1), 0);
    if (this.MAIN.test(kind)) return list.map(part => this._mainLine(part, list.length, reserve));
    if (kind === 'dryer')
      return list.map(part => `${String(part.name).trim()}${(+part.qty || 1) > 1 ? ` × ${part.qty}` : ''}`);
    if (kind === 'filter') return [`${title}: ${count} ${this._stages(count)}`];
    if (kind === 'receiver') return [this._receiverLine(title, list, count)];
    return [`${title}: ${list.map(part => String(part.name).trim()).join(', ')}`];
  }

  /** «Компрессор × 3 (2 рабоч. + 1 резерв)» */
  static _mainLine(part, models, reserve) {
    const qty = Math.max(1, +part.qty || 1);
    const work = reserve && models === 1 && qty > reserve ? qty - reserve : 0;
    return `${String(part.name).trim()} × ${qty}${work ? ` (${work} рабоч. + ${reserve} резерв)` : ''}`;
  }

  static _stages(count) {
    if (count === 1) return 'ступень';
    return count < this.FEW_STAGES ? 'ступени' : 'ступеней';
  }

  static _receiverLine(title, list, count) {
    const volume = list.reduce((sum, part) => sum + (AirChain.volume(part) || 0) * Math.max(1, +part.qty || 1), 0);
    return `${title}: ${count} шт.${volume ? `, всего ${Mm.text(volume)} л` : ''}`;
  }

  /**
   * 3D-вид станции (готовый — сразу, иначе SVG-вид, затем подмена); щелчок — вкладка «Компоновка».
   * @param {object} item
   * @param {object|null} plan
   * @returns {string}
   */
  static pic(item, plan) {
    if (!plan || plan.level === 'error' || !plan.geo || !plan.geo.ext) return '';
    const meta = StationUi.meta(item, plan);
    const ready = StationRender.cached(plan);
    if (!ready) StationRender.image(plan, meta).then(image => this._swap(image, plan.hash));
    const src = ready ? ready.src : StationUi.url(StationView3D.svg(plan, meta));
    return `<button type="button" class="sq-pic" data-edtab="layout" title="Компоновка, чертёж и схема"><img src="${esc(src)}" data-sq3d="${esc(plan.hash || '')}" alt="3D-вид станции"><small>Компоновка и чертежи →</small></button>`;
  }

  static _swap(image, hash) {
    if (!image) return;
    for (const img of document.querySelectorAll('img[data-sq3d]')) if (img.dataset.sq3d === hash) img.src = image.src;
  }

  /**
   * Отпечаток главных требований подбора (и в каких кубометрах производительность) — изменился, подбор заново.
   * @param {object} query
   * @returns {string}
   */
  static sig(query) {
    return JSON.stringify([...this.AUTO.map(field => query[field] || 0), query.basis || 'fad']);
  }

  /**
   * Главное требование изменено у подобранной станции: подбор заново без вопроса (контейнер, шкафы и обвязка остаются) и
   * уведомление — что заменено; значение с ошибкой или пустое — без подбора (ошибка — под полем).
   * @param {number} index
   * @param {string} key изменённое поле
   */
  static async auto(index, key) {
    const item = S.items[index];
    if (!item || this.busy.has(item.id)) return;
    const query = this.query(item);
    if (!this._ready(item) || StationReq.ensure(item).pickSig === this.sig(query)) {
      KpForm.render();
      return;
    }
    const before = this.parts(item);
    await this._assemble(item, query);
    const changes = this.diff(before, this.parts(item));
    const what = this.CHANGED[key] || 'требование';
    Toast.show(
      `Изменено ${what} — комплектующие подобраны заново${changes.length ? `: ${changes.join('; ')}` : ' (состав тот же)'}`,
      this.TOAST_LONG,
    );
  }

  /** нет ошибок ввода и главное требование задано */
  static _ready(item) {
    const need = this.NEED[StationReq.kind(item)];
    return !ReqNum.errors(item).length && !(need && !(StationReq.num(StationReq.ensure(item)[need[0]]) > 0));
  }

  /** подбор из каталога и компоновка; затем окно, форма и изображения заново */
  static async _assemble(item, query) {
    const req = StationReq.ensure(item);
    this.busy.add(item.id);
    ItemEditor.render();
    try {
      const note = await TzPick.assemble(item, query);
      req.pick = note.slice(0, this.NOTE_MAX);
      req.pickSig = this.sig(query);
      KpState.persist();
    } catch (error) {
      Toast.show(`Не получилось подобрать: ${(error && error.message) || error}`);
    } finally {
      this.busy.delete(item.id);
    }
    ItemEditor.render();
    KpForm.render();
    StationImages.soon(item);
  }

  /**
   * Подбираемое оборудование станции: вид → «2 × название».
   * @param {object} item
   * @returns {Map<string, string[]>}
   */
  static parts(item) {
    const map = new Map();
    for (const part of Kit.parts(item)) {
      const kind = StationEquip.kindOf(part) || '';
      if (this.PICKED.test(kind))
        map.set(kind, [...(map.get(kind) || []), `${part.qty > 1 ? `${part.qty} × ` : ''}${part.name}`]);
    }
    return map;
  }

  /**
   * Что заменено: «компрессоры: 1 × A → 2 × B».
   * @param {Map<string, string[]>} before
   * @param {Map<string, string[]>} after
   * @returns {string[]}
   */
  static diff(before, after) {
    const out = [];
    for (const kind of new Set([...before.keys(), ...after.keys()])) {
      const was = (before.get(kind) || []).join(', ');
      const now = (after.get(kind) || []).join(', ');
      if (was !== now) out.push(`${this.WORDS[kind] || kind}: ${was || '—'} → ${now || '—'}`);
    }
    return out;
  }

  /**
   * «Подобрать оборудование»: требования станции → подбор из каталога, контейнер, компоновка, изображения.
   * @param {number} index
   */
  static async pick(index) {
    const item = S.items[index];
    if (!item) return;
    if (!this._pickAllowed(item)) return;
    await this._assemble(item, this.query(item));
    const calc = StationRules.ok() ? StationCalc.run(item) : null;
    Toast.show(
      calc && calc.errors.length && !calc.accept
        ? 'Подобрано, но не всё выполняется — смотрите строку итога'
        : 'Станция подобрана и скомпонована — изображения для КП готовятся',
    );
  }

  /** ввод без ошибок, главное требование задано, подбор заново — с согласия менеджера */
  static _pickAllowed(item) {
    const kind = StationReq.kind(item);
    const need = this.NEED[kind];
    const bad = ReqNum.errors(item);
    if (bad.length) {
      Toast.show(`Исправьте «${bad[0].label}»: ${bad[0].text}`);
      return false;
    }
    if (need && !(StationReq.num(StationReq.ensure(item)[need[0]]) > 0)) {
      Toast.show(`Укажите ${need[1]} — без неё станцию не подобрать`);
      return false;
    }
    const replaced = this.REPICK[kind] || this.REPICK.pump;
    return (
      !Kit.main(item) ||
      confirm(
        `Подобрать оборудование заново? ${replaced} заменятся подобранными из каталога; контейнер, шкафы и обвязка останутся.`,
      )
    );
  }

  /**
   * Требования станции → запрос подбора (числа).
   * @param {object} item
   * @returns {object}
   */
  static query(item) {
    const req = StationReq.of(item);
    const num = value =>
      StationReq.num(
        String(value ?? '')
          .replace(/[−–]/g, '-')
          .replace(/^\+/, ''),
      ) || 0;
    return {
      ...req,
      kind: StationReq.kind(item),
      oilFree: StationReq.oilFree(item),
      air: StationPlan.opts(item).air,
      flow: num(req.flow),
      pressure: num(req.pressure),
      q: num(req.q),
      head: num(req.head),
      kw: num(req.kw),
      hours: num(req.hours),
      recvVol: num(req.recvVol),
      work: +req.work || 0,
    };
  }

  /** Щелчок «Подобрать оборудование» на странице. */
  static listen() {
    document.addEventListener('click', event => {
      const button = event.target.closest && event.target.closest('[data-sq]');
      if (button && button.dataset.sq === 'pick') this.pick(+button.dataset.i);
    });
  }
}
