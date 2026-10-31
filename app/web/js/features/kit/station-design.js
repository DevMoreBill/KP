import { StationReq } from '../req/station-req.js';
import { ContainerKind } from './container-kind.js';
import { StationGeo } from '../layout/station-geo.js';
import { KitView } from './kit-view.js';
import { Mm } from '../layout/mm.js';
import { StationPlan } from './station-plan.js';
import { Kit } from '../../core/kit.js';
/**
 * Блок КП «Устройство станции»: контейнер, размещение, сжатый воздух, вентиляция, отопление, освещение, электропитание,
 * пожарная безопасность — из компоновки и систем контейнера, без выдуманных значений.
 */
export class StationDesign {
  static LABEL = 'Устройство станции';

  /**
   * Миллиметры текстом.
   * @param {number} value
   * @returns {string}
   */
  static size(value) {
    return Mm.text(value);
  }

  /**
   * Строки [раздел, текст]; пустые разделы — без строки.
   * @param {object} item станция
   * @returns {Array<[string, string]>}
   */
  static items(item) {
    const plan = this._plan(item);
    if (!plan) return [];
    const container = Kit.container(item) || {};
    const view = { item, plan, container, on: id => KitView.sysOn(item, container, id) };
    return [
      this._container(view),
      this._placement(view),
      this._air(view),
      this._vent(view),
      this._heat(view),
      this._light(view),
      this._power(view),
      this._fire(view),
      view.on('noise') ? ['Шумоизоляция', 'Внутренняя обшивка шумопоглощающим материалом.'] : null,
      view.on('snow') ? ['Снегозащита', 'Откидные козырьки (маркизы) над приточными жалюзи.'] : null,
    ].filter(Boolean);
  }

  /** готовая компоновка станции или null */
  static _plan(item) {
    if (!StationPlan.enabled(item)) return null;
    let plan;
    try {
      plan = StationPlan.plan(item);
    } catch {
      return null;
    }
    if (!plan || plan.level === 'error' || plan.level === 'none' || !plan.geo || !plan.geo.ext) return null;
    return plan;
  }

  static _container({ plan, container }) {
    const [length, width, height] = plan.geo.ext;
    const roof = StationGeo.ROOFS[StationGeo.roof(container)];
    const floor = StationGeo.FLOORS[StationGeo.floor(container)];
    const climate = ContainerKind.CLIMATES.find(row => row[0] === container.climate);
    const ins = container.ins ? `, утепление ${container.ins}` : '';
    const clim = climate ? `, климатическое исполнение ${climate[0]} (${climate[1]})` : '';
    return [
      'Контейнер',
      `${ContainerKind.of(container.ctype).name}, ${this.size(length)} × ${this.size(width)} × ${this.size(height)} мм${ins}${clim}; крыша ${roof ? roof.name : 'плоская'}, пол — ${floor ? floor.name : ''}.`,
    ];
  }

  /** размещение: проход или обслуживание через ворота, двери, ворота */
  static _placement({ plan }) {
    const doors = plan.doors || [];
    const ends = (plan.mode || {}).ends;
    const service = doors.filter(door => door.kind === 'service');
    const two = !!(plan.fire || {}).exit2 || doors.some(door => door.kind === 'entry');
    const place = [
      ends
        ? 'основной агрегат — у торца, обслуживание через ворота с обеих сторон'
        : 'оборудование — вдоль стены с проходом для обслуживания',
      two ? 'две двери оператора' : 'дверь оператора с доводчиком',
    ];
    if (plan.gates)
      place.push(
        `распашные утеплённые ворота в торце ${this.size(plan.gates.w)} × ${this.size(plan.gates.h)} мм для монтажа и демонтажа оборудования`,
      );
    if (plan.gates2) place.push('вторые ворота в противоположном торце');
    if (service.length && !ends) place.push(`сервисные ворота для обслуживания агрегатов (${service.length} шт.)`);
    return ['Размещение оборудования', `${this.cap(place.join('; '))}.`];
  }

  /** компрессорная: цепочка подготовки воздуха и трубопровод */
  static _air({ item, plan }) {
    if (StationReq.kind(item) !== 'comp') return null;
    const chain = this._chain(plan.air);
    const parts = [
      chain ? `последовательно: ${chain.toLowerCase()}` : '',
      (plan.items || []).some(unit => unit.kind === 'dryer') ? 'обводная линия (байпас) осушителя' : '',
      `${this._pipe(plan)}; запорная арматура на каждом агрегате`,
    ];
    return ['Сжатый воздух', `${this.cap(parts.filter(Boolean).join('; '))}.`];
  }

  /** «компрессоры → осушитель → ресивер → потребителю» (повторы подряд — один раз) */
  static _chain(air) {
    if (!air || !air.chain || !air.chain.length) return '';
    const steps = air.chain.map(step => step.text).filter((text, i, all) => text !== all[i - 1]);
    return `${steps.join(' → ')} → потребителю`;
  }

  static _pipe(plan) {
    const first = (plan.piping || [])[0];
    const bore = plan.pipe && plan.pipe.dn;
    return [
      first && first.matText ? `трубопровод — ${first.matText}` : 'трубопровод стальной',
      bore ? `DN ${bore}` : '',
    ]
      .filter(Boolean)
      .join(', ');
  }

  static _vent({ plan, on }) {
    const vent = plan.vent;
    if (!on('vent') || !vent || !vent.size) return null;
    const text = [];
    if (vent.size.in) text.push(`приток — жалюзи ${this._louver(vent.size.in)} с клапанами на электроприводе`);
    if ((vent.roof || []).length) text.push('выброс горячего воздуха от компрессоров — воздуховодами через крышу');
    else if (vent.size.out) text.push(`выброс горячего воздуха — жалюзи ${this._louver(vent.size.out)}`);
    text.push('управление по термодатчику');
    if (on('rec')) text.push('зимой — рециркуляция тёплого воздуха');
    return ['Вентиляция', `${this.cap(text.join('; '))}.`];
  }

  /** «2 × 1 200 × 800 мм» */
  static _louver(size) {
    return `${size.n > 1 ? `${size.n} × ` : ''}${this.size(size.w)} × ${this.size(size.h)} мм`;
  }

  static _heat({ plan, on }) {
    const heat = plan.heat;
    if (!on('heat') || !heat || !(heat.n > 0)) return null;
    return [
      'Отопление',
      `Электрические конвекторы с терморегуляторами — ${heat.n} × ${String(heat.kw).replace('.', ',')} кВт; поддержание в помещении не ниже +${heat.tin} °C.`,
    ];
  }

  static _light({ plan, on }) {
    const light = plan.light;
    if (!on('light') || !light || !(light.n > 0)) return null;
    const emergency = light.em ? `, аварийные — ${light.em} шт` : '';
    const floods = light.floods ? `, прожекторы над дверями — ${light.floods} шт` : '';
    return ['Освещение', `Светодиодные светильники — ${light.n} шт. (${light.lux} лк)${emergency}${floods}.`];
  }

  static _power({ plan, on }) {
    const power = plan.power;
    if (!on('power') || !power || !(power.kw > 0)) return null;
    const breaker = power.breaker ? `, вводной автомат ${power.breaker} А` : '';
    return [
      'Электропитание',
      `Щит собственных нужд; ввод 3 × 400 В, расчётная мощность ${String(power.kw).replace('.', ',')} кВт${breaker}; розетки, заземление.`,
    ];
  }

  static _fire({ plan, on }) {
    const fire = plan.fire || {};
    const parts = [
      fire.cat ? `категория помещения ${fire.cat}` : '',
      fire.ext ? `огнетушители — ${fire.ext} шт` : '',
      on('fire') && fire.mods ? `модули автоматического пожаротушения — ${fire.mods} шт` : '',
      on('ops') ? 'охранно-пожарная сигнализация' : '',
      'знаки и табло «Выход»',
    ];
    return ['Пожарная безопасность', `${this.cap(parts.filter(Boolean).join('; '))}.`];
  }

  /**
   * С заглавной буквы.
   * @param {string} text
   * @returns {string}
   */
  static cap(text) {
    const line = String(text || '');
    return line ? line[0].toUpperCase() + line.slice(1) : line;
  }

  /**
   * Текст блока: каждый раздел — строкой «• Раздел: текст».
   * @param {object} item
   * @returns {string}
   */
  static text(item) {
    return this.items(item)
      .map(([sec, line]) => `• ${sec}: ${line}`)
      .join('\n');
  }

  /**
   * Блок описания для документа или null; свой блок менеджера «Устройство…» важнее.
   * @param {object} item
   * @returns {{id: string, label: string, text: string}|null}
   */
  static feature(item) {
    const own = (item.features || []).some(
      block => /устройств/i.test(String(block.label || '')) && String(block.text || '').trim(),
    );
    if (own) return null;
    const text = this.text(item);
    return text ? { id: 'st_design', label: this.LABEL, text } : null;
  }
}
