import { Mm } from '../layout/mm.js';
import { StationLayout } from '../layout/station-layout.js';

/** Двери и ворота станции для ТЗ: дверь оператора и сервисные — разные двери; у ДГУ — дверь-жалюзи. */
export class TzDoors {
  static WALL = { right: 'в дальнем торце', left: 'в торце у входа', back: 'в задней стене' };
  static LOCKS = 'утеплённые, с замками и запорными штангами';

  /** Двери по расстановке — одной строкой. */
  static text(plan) {
    return [
      ...this._entry(plan),
      ...this._gates(plan),
      ...this._second(plan),
      ...this._service(plan),
      ...this._dgu(plan),
      ...this._exhaust(plan),
    ].join('; ');
  }

  static _entry(plan) {
    const entry = plan.entry;
    if (!entry) return [];
    if (entry.sea) return ['оператора — штатные двери контейнера в торце'];
    return [
      `оператора — одностворчатая ${Mm.text(entry.w)} мм (не менее ${Mm.text(StationLayout.DOOR_MIN)} мм в свету)${entry.wall === 'left' ? ' в торце' : ''}, утеплённая, открывается наружу, с замком и доводчиком (доводчик — внутри); рядом — таблички, знаки и огнетушители`,
    ];
  }

  static _gates(plan) {
    const gates = plan.gates;
    const out = [];
    if (gates && gates.sea)
      out.push(
        `в торце — штатные двери контейнера${gates.pos.length ? ` (монтаж и демонтаж поз. ${gates.pos.join(', ')})` : ''}`,
      );
    for (const gate of [gates && !gates.sea ? gates : null, plan.gates2].filter(Boolean))
      out.push(this._gate(plan, gate));
    return out;
  }

  static _gate(plan, gate) {
    const exit =
      gate.wall === 'right' && (plan.items || []).some(i => i.pairEnd)
        ? 'перед ними ресиверы в два ряда — не выход'
        : 'это и выход';
    return `распашные монтажные ворота ${gate.full ? 'во весь торец ' : ''}${Mm.text(gate.w)} × ${Mm.text(gate.h)} мм в ${gate.wall === 'left' ? 'торце у входа' : 'дальнем торце'} (открываются наружу, ${exit})${gate.pos.length ? ` — поз. ${gate.pos.join(', ')}` : ''}; утеплённые, с замками, запорными штангами и фиксаторами открытого положения. ${StationLayout.gateAxis(gate)} Проём в торцевой раме — с усилением (ригель над проёмом, стойки по краям) по расчёту изготовителя`;
  }

  static _second(plan) {
    if (!plan.second) return [];
    const where = this._secondWhere(plan);
    return [
      `вторая дверь оператора (${plan.second})${where ? ` — ${where}` : ''}: открывается наружу, изнутри — без ключа, с доводчиком`,
    ];
  }

  static _secondWhere(plan) {
    const wicket = plan.gates && plan.gates.wicket;
    const two = (plan.doors || []).find(door => door.kind === 'entry');
    if (plan.exit) return `одностворчатая ${Mm.text(plan.exit.w)} мм в дальнем торце`;
    if (wicket) return `калитка ${Mm.text(wicket.w)} × ${Mm.text(wicket.h)} мм в створке ворот`;
    if (plan.secondDgu) return 'выход через дверь-жалюзи ДГУ';
    if (two) return `одностворчатая ${Mm.text(two.w)} мм в стене прохода у дальнего торца`;
    return '';
  }

  static _list(doors) {
    return doors
      .map(
        door =>
          `${Mm.text(door.w)} × ${Mm.text(door.h)} мм в ${door.wall === 'back' ? 'задней' : 'передней'} стене (${door.leaves > 1 ? 'двустворчатые' : 'одностворчатые'}, поз. ${door.pos.join(', ')})`,
      )
      .join(', ');
  }

  /** Сервисные ворота: с обеих сторон компрессора, за оборудованием у стены, для монтажа; нет — через дверь оператора. */
  static _service(plan) {
    const service = (plan.doors || []).filter(door => door.kind !== 'entry');
    const gates = plan.gates;
    const both = service.filter(door => door.both);
    const rear = service.filter(door => door.rear && !door.both);
    const front = service.filter(door => !door.rear);
    const out = [];
    if (both.length)
      out.push(
        `сервисные распашные ворота с обеих сторон компрессора (без продольного прохода: обслуживание спереди и сзади, монтаж и демонтаж): ${this._list(both)}; ${this.LOCKS}`,
      );
    if (rear.length)
      out.push(
        `сервисные распашные ворота за оборудованием, стоящим плотно к стене, — для обслуживания, монтажа и демонтажа: ${this._list(rear)}; ${this.LOCKS}`,
      );
    if (front.length)
      out.push(
        `сервисные распашные ворота — для монтажа и демонтажа, где к воротам в торце не провезти: ${this._list(front)}; ${this.LOCKS}`,
      );
    if (!out.length && (!gates || !gates.pos.length))
      out.push('ворот и сервисных дверей нет — оборудование вносится и выносится через дверь оператора');
    return out;
  }

  static _dgu(plan) {
    const doors = plan.dguDoors || (plan.dguDoor ? [plan.dguDoor] : []);
    if (!doors.length) return [];
    const size = [...new Set(doors.map(door => `${Mm.text(door.w)} × ${Mm.text(door.h)} мм`))].join(' / ');
    const where = [...new Set(doors.map(door => this.WALL[door.wall || 'right']))].join(' и ');
    return [
      `${doors.length > 1 ? `у каждой ДГУ (${doors.length} шт.)` : 'ДГУ'} — напротив радиатора двустворчатая дверь-жалюзи ${size} ${where}: выброс горячего воздуха радиатора и проём для монтажа и демонтажа ДГУ (с утеплённым клапаном с электроприводом изнутри)`,
    ];
  }

  static _exhaust(plan) {
    const wallExhausts = (plan.exhausts || []).filter(exhaust => exhaust.how === 'wall');
    if (!wallExhausts.length) return [];
    return [
      `выхлоп ${wallExhausts.length > 1 ? `${wallExhausts.length} ДГУ` : 'ДГУ'} — через заднюю стену (глушитель встроен в ДГУ), у каждой свой вывод: гильза с негорючей теплоизоляцией, снаружи отвод вниз под 45° с дождевым колпаком`,
    ];
  }
}
