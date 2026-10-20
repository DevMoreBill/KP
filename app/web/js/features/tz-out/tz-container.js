import { StationGeo } from '../layout/station-geo.js';
import { StationLayout } from '../layout/station-layout.js';
import { StationMods } from '../layout/station-mods.js';
import { StationNorms } from '../layout/station-norms.js';
import { StationPaint } from '../layout/station-paint.js';
import { TzDoors } from './tz-doors.js';
import { TzSystems } from './tz-systems.js';

/** Раздел ТЗ «Контейнер и его системы»: строки таблицы требований. */
export class TzContainer {
  static N = v => StationLayout.n(v);
  /** Исполнение контейнера — как видно на чертеже и 3D-виде. */
  static BUILD = {
    block: 'каркас из гнутого профиля, стены и кровля — сэндвич-панели с минеральной ватой',
    welded:
      'цельносварной стальной каркас и корпус, наружная обшивка — профилированный лист от 1,5 мм с антикоррозионной обработкой',
    north: 'сэндвич-панели с усиленным утеплением, тамбур у входа',
    sea: 'морской контейнер ISO: гофрированные стальные стены, штатные двери в торце',
  };

  /** t — состав ТЗ (TzText): станция, контейнер, расстановка, климат. */
  static rows(t) {
    const { x, c, plan } = t;
    const ct = ctypeOf(c.ctype);
    return [
      ['Тип', ct.name],
      ['Исполнение', this.BUILD[StationGeo.SEA[c.ctype] ? 'sea' : c.ctype] || this.BUILD.block],
      ['Размеры (Д × Ш × В)', this._dims(t, ct)],
      ...this._mods(t),
      ['Крыша', this._roof(t)],
      [
        'Пол',
        `${StationGeo.FLOORS[StationGeo.floor(c)].name} по утеплённому основанию; под оборудованием — закладные или рама`,
      ],
      ['Строповка', this._sling(t)],
      ['Утепление', c.ins ? `минеральная вата ${c.ins}, пароизоляция, внутренняя обшивка` : 'по типу контейнера'],
      [
        'Климатическое исполнение',
        t.cl ? `${t.cl[0]} по ГОСТ 15150-69 (${t.cl[1]})` : 'по ГОСТ 15150-69 — по месту установки',
      ],
      ['Наружный воздух', this._air(t.req)],
      ['Окраска', this._paint(c)],
      ...this._arts(c),
      ['Двери', `${TzDoors.text(plan) + this._fuel(plan)}; над входами — съёмные козырьки и светодиодные прожекторы`],
      ...CONT_SYSTEMS.filter(([id]) => KitView.sysOn(x, c, id)).map(([id, k, v]) => [k, TzSystems.text(id, v, plan)]),
    ];
  }

  static _dims(t, ct) {
    const n = this.N;
    const { plan } = t;
    if (!t.ok) return String(t.c.size || '').trim() || ct.size;
    return `наружные ${n(plan.geo.ext[0])} × ${n(plan.geo.ext[1])} × ${n(plan.geo.ext[2])} мм, внутри ${n(plan.int[0])} × ${n(plan.int[1])} × ${n(plan.int[2])} мм`;
  }

  /** Станция из модулей: собирают и проверяют на производстве, на объекте — быстрая стыковка. */
  static _mods(t) {
    const { plan } = t;
    if (!(t.ok && plan.geo.mods && plan.geo.mods.Lm)) return [];
    const n = this.N;
    const md = plan.geo.mods;
    const ms = plan.mass && plan.mass.mods;
    return [
      [
        'Модули',
        `${StationMods.shape(md)} (М1…М${md.n} — на плане чертежа): модуль ${n(md.Lm)} × ${n(md.Wm)} × ${n(plan.geo.ext[2])} мм${ms ? `, масса модуля — до ${n(plan.mass.top.mass)} кг` : ''}; каждый агрегат — целиком в своём модуле (на стыках оборудования нет). На производстве станцию собирают и стыкуют, обвязывают, запускают и проверяют; на перевозку — расстыковка трубопровода, кабелей и коммуникаций на стыках (разъёмные соединения, маркировка), стыковые проёмы — временными щитами, модули везут с оборудованием внутри (оборудование закреплено). На объекте — быстрая стыковка: стыковые стены не устанавливаются, каркасы соединяются болтами, стыки — уплотнение, нащельники на стенах и кровле, пол без порога, подключение сетей через стык. Стыков — ${StationMods.joints(md)}.`,
      ],
    ];
  }

  static _roof(t) {
    const { c } = t;
    const rf = StationGeo.roof(c);
    return `${rf === 'flat' ? this._flat(c) : this._pitched(t, rf)}; водостоки не устанавливаются, над дверями — небольшие съёмные козырьки`;
  }

  static _flat(c) {
    return StationGeo.SEA[c.ctype] ? 'штатная' : 'плоская, с уклоном и отливами по краям';
  }

  static _pitched(t, rf) {
    const n = this.N;
    const ro = StationGeo.ROOFS[rf];
    const rise = t.ok ? t.plan.geo.rise || 0 : 0;
    return `${ro.name}${ro.deg ? `, уклон ${ro.deg}°` : ''}${rf === 'mono' ? ', скат — к задней стене (не на вход)' : ''}${rise ? `, высота ${rf === 'mono' ? 'у стены с дверью' : 'по коньку'} ${n(t.plan.geo.ext[2] + rise)} мм` : ''}`;
  }

  static _sling(t) {
    const { c, plan } = t;
    const how = StationGeo.SEA[c.ctype]
      ? 'за четыре верхних угловых фитинга (ISO 1161) — по схеме строповки'
      : 'четыре строповочные петли в верхних углах рамы, грузоподъёмность — по массе станции с оборудованием; схема строповки — на контейнере';
    if (!(t.ok && plan.mass)) return how;
    return `${how}; масса станции — около ${this.N(plan.mass.mass)} кг, грузоподъёмность каждой ветви стропа — не менее ${String(plan.mass.sling.wll.leg).replace('.', ',')} т (РД 10-33-93, п. 2.1.4)`;
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

  static _paint(c) {
    const f = StationPaint.book(c) && c.paintFile;
    return (
      StationPaint.tz(c) +
      (f ? ` — файл «${c.paintFile.name || 'буклет'}»${c.paintFile.pdf ? ' (передаётся вместе с ТЗ)' : ''}` : '')
    );
  }

  static _arts(c) {
    const A = StationPaint.arts(c);
    if (!A.length) return [];
    return [
      [
        'Изображения заказчика',
        `${A.map((a, k) => `${k + 1}) ${StationPaint.where(a)} — макет в приложении`).join('; ')}. Нанесение — плёнкой или краской по макету, стойким к атмосферным воздействиям; цвета и размеры макета — согласовать с заказчиком до нанесения.`,
      ],
    ];
  }

  /** Вход в отсек топливного бака ДГУ. */
  static _fuel(plan) {
    const f = plan.fuel;
    const n = this.N;
    if (!f) return '';
    if (f.gate)
      return `; отсек топливного бака — двустворчатые ворота в левом торце ${n(f.gate.w)} × ${n(f.gate.h)} мм (монтаж и замена бака), с замком и запорными штангами, с жалюзи внизу и вверху створок`;
    if (f.door)
      return `; отсек топливного бака — отдельная дверь ${n(f.door.x1 - f.door.x0)} мм наружу, с замком и доводчиком (внутри), с решёткой внизу`;
    return '; отсек топливного бака — через штатные двери контейнера';
  }
}
