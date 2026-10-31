import { Mm } from '../layout/mm.js';
import { StationGeo } from '../layout/station-geo.js';
import { StationMods } from '../layout/station-mods.js';
import { StationNorms } from '../layout/station-norms.js';
import { StationPaint } from '../layout/station-paint.js';
import { TzDoors } from './tz-doors.js';
import { TzSystems } from './tz-systems.js';
import { ContainerKind } from '../layout/container-kind.js';
import { KitContainer } from '../kit/kit-container.js';

/** Раздел ТЗ «Контейнер и его системы»: строки таблицы требований. */
export class TzContainer {
  /** Исполнение контейнера — как видно на чертеже и 3D-виде. */
  static BUILD = {
    block: 'каркас из гнутого профиля, стены и кровля — сэндвич-панели с минеральной ватой',
    welded:
      'цельносварной стальной каркас и корпус, наружная обшивка — профилированный лист от 1,5 мм с антикоррозионной обработкой',
    north: 'сэндвич-панели с усиленным утеплением, тамбур у входа',
    sea: 'морской контейнер ISO: гофрированные стальные стены, штатные двери в торце',
  };

  /** t — состав ТЗ (TzText): станция, контейнер, расстановка, климат. */
  static rows(spec) {
    const { x, c: container, plan } = spec;
    const ctype = ContainerKind.of(container.ctype);
    return [
      ['Тип', ctype.name],
      ['Исполнение', this.BUILD[StationGeo.SEA[container.ctype] ? 'sea' : container.ctype] || this.BUILD.block],
      ['Размеры (Д × Ш × В)', this._dims(spec, ctype)],
      ...this._mods(spec),
      ['Крыша', this._roof(spec)],
      [
        'Пол',
        `${StationGeo.FLOORS[StationGeo.floor(container)].name} по утеплённому основанию; под оборудованием — закладные или рама`,
      ],
      ['Строповка', this._sling(spec)],
      [
        'Утепление',
        container.ins ? `минеральная вата ${container.ins}, пароизоляция, внутренняя обшивка` : 'по типу контейнера',
      ],
      [
        'Климатическое исполнение',
        spec.cl ? `${spec.cl[0]} по ГОСТ 15150-69 (${spec.cl[1]})` : 'по ГОСТ 15150-69 — по месту установки',
      ],
      ['Наружный воздух', this._air(spec.req)],
      ['Окраска', this._paint(container)],
      ...this._arts(container),
      ['Двери', `${TzDoors.text(plan) + this._fuel(plan)}; над входами — съёмные козырьки и светодиодные прожекторы`],
      ...ContainerKind.SYSTEMS.filter(([id]) => KitContainer.sysOn(x, container, id)).map(([id, label, base]) => [
        label,
        TzSystems.text(id, base, plan),
      ]),
    ];
  }

  static _dims(spec, ctype) {
    const { plan } = spec;
    if (!spec.ok) return String(spec.c.size || '').trim() || ctype.size;
    return `наружные ${Mm.text(plan.geo.ext[0])} × ${Mm.text(plan.geo.ext[1])} × ${Mm.text(plan.geo.ext[2])} мм, внутри ${Mm.text(plan.int[0])} × ${Mm.text(plan.int[1])} × ${Mm.text(plan.int[2])} мм`;
  }

  /** Станция из модулей: собирают и проверяют на производстве, на объекте — быстрая стыковка. */
  static _mods(spec) {
    const { plan } = spec;
    if (!(spec.ok && plan.geo.mods && plan.geo.mods.Lm)) return [];
    const mods = plan.geo.mods;
    const modMass = plan.mass && plan.mass.mods;
    return [
      [
        'Модули',
        `${StationMods.shape(mods)} (М1…М${mods.n} — на плане чертежа): модуль ${Mm.text(mods.Lm)} × ${Mm.text(mods.Wm)} × ${Mm.text(plan.geo.ext[2])} мм${modMass ? `, масса модуля — до ${Mm.text(plan.mass.top.mass)} кг` : ''}; каждый агрегат — целиком в своём модуле (на стыках оборудования нет). На производстве станцию собирают и стыкуют, обвязывают, запускают и проверяют; на перевозку — расстыковка трубопровода, кабелей и коммуникаций на стыках (разъёмные соединения, маркировка), стыковые проёмы — временными щитами, модули везут с оборудованием внутри (оборудование закреплено). На объекте — быстрая стыковка: стыковые стены не устанавливаются, каркасы соединяются болтами, стыки — уплотнение, нащельники на стенах и кровле, пол без порога, подключение сетей через стык. Стыков — ${StationMods.joints(mods)}.`,
      ],
    ];
  }

  static _roof(spec) {
    const { c: container } = spec;
    const roof = StationGeo.roof(container);
    return `${roof === 'flat' ? this._flat(container) : this._pitched(spec, roof)}; водостоки не устанавливаются, над дверями — небольшие съёмные козырьки`;
  }

  static _flat(container) {
    return StationGeo.SEA[container.ctype] ? 'штатная' : 'плоская, с уклоном и отливами по краям';
  }

  static _pitched(spec, roof) {
    const roofType = StationGeo.ROOFS[roof];
    const rise = spec.ok ? spec.plan.geo.rise || 0 : 0;
    return `${roofType.name}${roofType.deg ? `, уклон ${roofType.deg}°` : ''}${roof === 'mono' ? ', скат — к задней стене (не на вход)' : ''}${rise ? `, высота ${roof === 'mono' ? 'у стены с дверью' : 'по коньку'} ${Mm.text(spec.plan.geo.ext[2] + rise)} мм` : ''}`;
  }

  static _sling(spec) {
    const { c: container, plan } = spec;
    const how = StationGeo.SEA[container.ctype]
      ? 'за четыре верхних угловых фитинга (ISO 1161) — по схеме строповки'
      : 'четыре строповочные петли в верхних углах рамы, грузоподъёмность — по массе станции с оборудованием; схема строповки — на контейнере';
    if (!(spec.ok && plan.mass)) return how;
    return `${how}; масса станции — около ${Mm.text(plan.mass.mass)} кг, грузоподъёмность каждой ветви стропа — не менее ${Mm.dec(plan.mass.sling.wll.leg)} т (РД 10-33-93, п. 2.1.4)`;
  }

  static _air(req) {
    return (
      [
        req.tmin != null ? `от ${StationNorms.deg(req.tmin)}` : '',
        req.tmax != null ? `до ${StationNorms.deg(req.tmax)}` : '',
      ]
        .filter(Boolean)
        .join(' ') || 'по месту установки'
    );
  }

  static _paint(container) {
    const booklet = StationPaint.book(container) && container.paintFile;
    return (
      StationPaint.tzRows(container) +
      (booklet
        ? ` — файл «${container.paintFile.name || 'буклет'}»${container.paintFile.pdf ? ' (передаётся вместе с ТЗ)' : ''}`
        : '')
    );
  }

  static _arts(container) {
    const arts = StationPaint.arts(container);
    if (!arts.length) return [];
    return [
      [
        'Изображения заказчика',
        `${arts.map((art, k) => `${k + 1}) ${StationPaint.where(art)} — макет в приложении`).join('; ')}. Нанесение — плёнкой или краской по макету, стойким к атмосферным воздействиям; цвета и размеры макета — согласовать с заказчиком до нанесения.`,
      ],
    ];
  }

  /** Вход в отсек топливного бака ДГУ. */
  static _fuel(plan) {
    const fuel = plan.fuel;
    if (!fuel) return '';
    if (fuel.gate)
      return `; отсек топливного бака — двустворчатые ворота в левом торце ${Mm.text(fuel.gate.w)} × ${Mm.text(fuel.gate.h)} мм (монтаж и замена бака), с замком и запорными штангами, с жалюзи внизу и вверху створок`;
    if (fuel.door)
      return `; отсек топливного бака — отдельная дверь ${Mm.text(fuel.door.x1 - fuel.door.x0)} мм наружу, с замком и доводчиком (внутри), с решёткой внизу`;
    return '; отсек топливного бака — через штатные двери контейнера';
  }
}
