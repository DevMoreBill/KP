import { StationLayout } from '../layout/station-layout.js';

/** Двери и ворота станции для ТЗ: дверь оператора и сервисные — разные двери; у ДГУ — дверь-жалюзи. */
export class TzDoors {
  static N = v => StationLayout.n(v);
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
    const en = plan.entry;
    if (!en) return [];
    if (en.sea) return ['оператора — штатные двери контейнера в торце'];
    const n = this.N;
    return [
      `оператора — одностворчатая ${n(en.w)} мм (не менее ${n(StationLayout.DOOR_MIN)} мм в свету)${en.wall === 'left' ? ' в торце' : ''}, утеплённая, открывается наружу, с замком и доводчиком (доводчик — внутри); рядом — таблички, знаки и огнетушители`,
    ];
  }

  static _gates(plan) {
    const G = plan.gates;
    const out = [];
    if (G && G.sea)
      out.push(
        `в торце — штатные двери контейнера${G.pos.length ? ` (монтаж и демонтаж поз. ${G.pos.join(', ')})` : ''}`,
      );
    for (const Q of [G && !G.sea ? G : null, plan.gates2].filter(Boolean)) out.push(this._gate(plan, Q));
    return out;
  }

  static _gate(plan, Q) {
    const n = this.N;
    const exit =
      Q.wall === 'right' && (plan.items || []).some(i => i.pairEnd)
        ? 'перед ними ресиверы в два ряда — не выход'
        : 'это и выход';
    return `распашные монтажные ворота ${Q.full ? 'во весь торец ' : ''}${n(Q.w)} × ${n(Q.h)} мм в ${Q.wall === 'left' ? 'торце у входа' : 'дальнем торце'} (открываются наружу, ${exit})${Q.pos.length ? ` — поз. ${Q.pos.join(', ')}` : ''}; утеплённые, с замками, запорными штангами и фиксаторами открытого положения. ${StationLayout.gateAxis(Q)} Проём в торцевой раме — с усилением (ригель над проёмом, стойки по краям) по расчёту изготовителя`;
  }

  static _second(plan) {
    if (!plan.second) return [];
    const w2 = this._secondWhere(plan);
    return [
      `вторая дверь оператора (${plan.second})${w2 ? ` — ${w2}` : ''}: открывается наружу, изнутри — без ключа, с доводчиком`,
    ];
  }

  static _secondWhere(plan) {
    const n = this.N;
    const wk = plan.gates && plan.gates.wicket;
    const two = (plan.doors || []).find(d => d.kind === 'entry');
    if (plan.exit) return `одностворчатая ${n(plan.exit.w)} мм в дальнем торце`;
    if (wk) return `калитка ${n(wk.w)} × ${n(wk.h)} мм в створке ворот`;
    if (plan.secondDgu) return 'выход через дверь-жалюзи ДГУ';
    if (two) return `одностворчатая ${n(two.w)} мм в стене прохода у дальнего торца`;
    return '';
  }

  static _list(D) {
    const n = this.N;
    return D.map(
      d =>
        `${n(d.w)} × ${n(d.h)} мм в ${d.wall === 'back' ? 'задней' : 'передней'} стене (${d.leaves > 1 ? 'двустворчатые' : 'одностворчатые'}, поз. ${d.pos.join(', ')})`,
    ).join(', ');
  }

  /** Сервисные ворота: с обеих сторон компрессора, за оборудованием у стены, для монтажа; нет — через дверь оператора. */
  static _service(plan) {
    const S = (plan.doors || []).filter(d => d.kind !== 'entry');
    const G = plan.gates;
    const B = S.filter(d => d.both);
    const R = S.filter(d => d.rear && !d.both);
    const F = S.filter(d => !d.rear);
    const out = [];
    if (B.length)
      out.push(
        `сервисные распашные ворота с обеих сторон компрессора (без продольного прохода: обслуживание спереди и сзади, монтаж и демонтаж): ${this._list(B)}; ${this.LOCKS}`,
      );
    if (R.length)
      out.push(
        `сервисные распашные ворота за оборудованием, стоящим плотно к стене, — для обслуживания, монтажа и демонтажа: ${this._list(R)}; ${this.LOCKS}`,
      );
    if (F.length)
      out.push(
        `сервисные распашные ворота — для монтажа и демонтажа, где к воротам в торце не провезти: ${this._list(F)}; ${this.LOCKS}`,
      );
    if (!out.length && (!G || !G.pos.length))
      out.push('ворот и сервисных дверей нет — оборудование вносится и выносится через дверь оператора');
    return out;
  }

  static _dgu(plan) {
    const D = plan.dguDoors || (plan.dguDoor ? [plan.dguDoor] : []);
    if (!D.length) return [];
    const n = this.N;
    const size = [...new Set(D.map(g => `${n(g.w)} × ${n(g.h)} мм`))].join(' / ');
    const where = [...new Set(D.map(g => this.WALL[g.wall || 'right']))].join(' и ');
    return [
      `${D.length > 1 ? `у каждой ДГУ (${D.length} шт.)` : 'ДГУ'} — напротив радиатора двустворчатая дверь-жалюзи ${size} ${where}: выброс горячего воздуха радиатора и проём для монтажа и демонтажа ДГУ (с утеплённым клапаном с электроприводом изнутри)`,
    ];
  }

  static _exhaust(plan) {
    const E = (plan.exhausts || []).filter(e => e.how === 'wall');
    if (!E.length) return [];
    return [
      `выхлоп ${E.length > 1 ? `${E.length} ДГУ` : 'ДГУ'} — через заднюю стену (глушитель встроен в ДГУ), у каждой свой вывод: гильза с негорючей теплоизоляцией, снаружи отвод вниз под 45° с дождевым колпаком`,
    ];
  }
}
