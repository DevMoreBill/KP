import { AirChain } from './air-chain.js';
import { Num } from './num.js';
import { LayoutMode } from './layout-mode.js';
import { LayoutRoof } from './layout-roof.js';
import { Mm } from './mm.js';
import { PressureVessel } from './pressure-vessel.js';
import { StationGeo } from './station-geo.js';
import { StationHeat } from './station-heat.js';
import { StationMatrix } from './station-matrix.js';
import { StationMods } from './station-mods.js';
import { StationNorms } from './station-norms.js';
import { StationVent } from './station-vent.js';

/** Сведения и замечания плана: режимы-исключения, станция из модулей, условные габариты, ресиверы снаружи, бак, выхлоп. */
export class LayoutNotes {
  static _named = unit => `поз. ${unit.pos} «${unit.short}»`;

  static FILL_WALL = { left: 'в торце', front: 'в стене с дверью оператора', back: 'в задней стене' };

  constructor(lay) {
    this.lay = lay;
  }

  /** Режим-исключение: что сделано и почему (согласовать с заказчиком). */
  mode(res, modeInfo, geo) {
    const why =
      geo.auto || geo.road
        ? `станция прошла по габариту перевозки без спецразрешения (ширина до ${Mm.text(StationGeo.ROAD_W)} мм)`
        : 'оборудование поместилось в заданный контейнер';
    if (modeInfo.tight) this.tight(res, why);
    if (modeInfo.ends && res.ends) res.issues.push({ level: 'info', text: this._endsText(res.ends, why) });
    if (modeInfo.cross && res.cross) {
      res.issues.push({
        level: 'warn',
        text: `Сквозного прохода нет: поз. ${res.cross.pos} стоит поперёк станции лицом к входу — к нему спереди и к оборудованию до него подходят от двери оператора, к нему сзади и к оборудованию за ним — через вторую дверь оператора. Доступ ко всему оборудованию остаётся с разных сторон. Исключение, чтобы ${why}.`,
      });
    }
    res.mode = modeInfo;
  }

  /** Замечание о суженном проходе. */
  tight(res, why) {
    const [rec, min] = this.lay.aisle0;
    const aisleW = res.aisle && res.aisle.w;
    res.aisleRule = [rec, Math.min(min, LayoutMode.TIGHT)];
    if (aisleW < min) {
      res.issues.push({
        level: 'warn',
        text: `Проход оператора сужен до ${Mm.text(aisleW)} мм (норма — не менее ${Mm.text(min)} мм, ПУЭ, п. 4.1.23): исключение, чтобы ${why}. Согласуйте с заказчиком.`,
      });
    }
  }

  _endsText(ends, why) {
    const door = ends.next ? `поз. ${ends.next}` : 'остальным оборудованием';
    const recv = ends.recv.length
      ? `; ресиверы поз. ${ends.recv.join(', ')} — в два ряда у дальнего торца, доступ — через ворота там`
      : '';
    if (ends.n > 1) {
      return `Без продольного прохода: компрессоры поз. ${ends.all.join(', ')} (${ends.n} шт.) — рядом в ряд от торца по середине ширины, обслуживание спереди и сзади — через сервисные ворота с обеих сторон, сбоку — через ворота в торце и промежутки не меньше ${Mm.text(StationMatrix.modes().next)} мм между компрессорами и за последним; дверь оператора — между последним компрессором и ${door}${recv}. Так ${why}.`;
    }
    return `Без продольного прохода: поз. ${ends.pos} (компрессор) — у торца по середине ширины, обслуживание спереди и сзади — через сервисные ворота с обеих сторон, сбоку — через ворота в торце; дверь оператора — между компрессором и ${door}${recv}. Так ${why}.`;
  }

  /** Станция из модулей: раскладка, размер модуля, стыковка; на стыке и на стойке каркаса — ошибка. */
  mods(plan) {
    const geo = plan.geo;
    const mods = geo && geo.mods;
    if (!mods || !mods.Lm) return;
    const iss = (plan.issues = plan.issues || []);
    const [Li, Wi, Hi] = plan.int;
    const push = (level, text) => iss.push({ level, mods: true, text });
    push(
      'info',
      `Станция из модулей: ${StationMods.shape(mods)} — модуль ${Mm.text(mods.Lm)} × ${Mm.text(mods.Wm)} × ${Mm.text(geo.ext[2])} мм (в габарите перевозки, каждый везётся отдельно), вместе ${Mm.text(geo.ext[0])} × ${Mm.text(geo.ext[1])} мм, внутри — одно помещение ${Mm.text(Li)} × ${Mm.text(Wi)} × ${Mm.text(Hi)} мм. Каждый агрегат — целиком в своём модуле. На производстве станцию собирают и стыкуют, обвязывают, запускают и проверяют; на перевозку — расстыковка трубопровода, кабелей и коммуникаций на стыках (разъёмные соединения), стыковые проёмы — временными щитами; модули везут с оборудованием внутри. На объекте — быстрая стыковка: соединение каркасов, уплотнение, нащельники на стенах и кровле, пол без порога, подключение сетей через стык; стыков — ${StationMods.joints(mods)}.`,
    );
    this._modSize(mods, push);
    const cross = StationMods.cross(plan.items, geo);
    if (cross.length) {
      plan.level = 'error';
      push(
        'error',
        `Поз. ${Num.uniq(cross.map(i => i.pos)).join(', ')} — на стыке модулей: модуль везут с оборудованием внутри, каждый агрегат должен быть целиком в своём модуле. Выберите другую раскладку или размер модуля по оборудованию («Модули…»).`,
      );
    }
    this.posts(plan, push);
  }

  _modSize(mod, push) {
    const widths = StationMods.widths();
    const [low, high] = [widths[0], widths[widths.length - 1]];
    const lMin = StationMods.RULES.lMin;
    const maxL = StationMatrix.fit().maxL;
    if (mod.Wm < low || mod.Wm > high)
      push(
        'warn',
        `Ширина модуля ${Mm.text(mod.Wm)} мм — вне ${Mm.text(low)}…${Mm.text(high)} мм (модули — одной ширины, не шире габарита перевозки): уберите размер — он подберётся по оборудованию.`,
      );
    if (mod.Lm < lMin) {
      push(
        'warn',
        `Длина модуля ${Mm.text(mod.Lm)} мм — меньше ${Mm.text(lMin)} мм (модуль станции из нескольких модулей — не короче; «Настройки → Правила компоновки → Станция из нескольких модулей»): уберите размер — он подберётся по оборудованию, или соберите станцию из меньшего числа модулей.`,
      );
    }
    if (mod.Lm > maxL)
      push('warn', `Длина модуля ${Mm.text(mod.Lm)} мм — больше наибольшей длины перевозки ${Mm.text(maxL)} мм.`);
  }

  /** Стойки каркаса на пересечениях стыков: оборудование на стойке — ошибка, иначе — их обходят в проходе. */
  posts(plan, push) {
    const geo = plan.geo;
    const half = StationMods.RULES.post / 2;
    const floor = (plan.items || []).filter(i => i.mount !== 'wall' && i.mount !== 'pipe');
    for (const post of StationMods.posts(geo)) {
      const hit = StationMods.hits(floor, geo).filter(
        i => i.x < post.x + half && i.x + i.lx > post.x - half && i.y < post.y + half && i.y + i.ly > post.y - half,
      );
      if (hit.length) {
        plan.level = 'error';
        push(
          'error',
          `Поз. ${Num.uniq(hit.map(i => i.pos)).join(', ')} — на стойке каркаса стыка модулей (${Mm.text(post.x)}, ${Mm.text(post.y)} мм): выберите другую раскладку модулей или измените состав.`,
        );
      } else {
        push(
          'info',
          `Стойка каркаса на пересечении стыков модулей — ${Mm.text(2 * half)} × ${Mm.text(2 * half)} мм (${Mm.text(post.x)}, ${Mm.text(post.y)} мм от угла помещения): в проходе её обходят.`,
        );
      }
    }
  }

  /** Сведения плана: условные габариты, что не размещено, ресиверы снаружи, бак, отопление, учёт сосудов, крыша, трубы. */
  plan(plan) {
    const iss = plan.issues;
    LayoutNotes.insulation(plan, iss);
    this.sizes(iss);
    this.outside(plan, iss);
    this.fuel(plan, iss);
    StationHeat.notes(plan);
    if (plan.heat) StationVent.notes(plan);
    this.vessels(plan, iss);
    this.roof(plan, iss);
    this.exhausts(plan, iss);
    this.piping(plan, iss);
  }

  /** Утепление в карточке контейнера не понято — расчёт по умолчанию правил. */
  static insulation(plan, iss) {
    const geo = plan.geo;
    if (!geo || !geo.insText) return;
    iss.push({
      level: 'warn',
      text: `Утепление контейнера «${geo.insText}» не распознано — принято ${Mm.text(geo.t)} мм (размеры внутри, отопление). Укажите толщину в мм или «без утепления».`,
    });
  }

  /** Замечания о принятых и неизвестных габаритах. */
  sizes(iss) {
    const equip = this.lay.equip;
    const tanks = equip.filter(unit => unit.place && !unit.known && unit.kind === 'tank');
    if (tanks.length) {
      const list = tanks
        .map(
          unit =>
            `${LayoutNotes._named(unit)} ${unit.vol ? `${Mm.text(unit.vol)} л — ` : ''}${Mm.text(unit.l)} × ${Mm.text(unit.w)} × ${Mm.text(unit.h)} мм`,
        )
        .join('; ');
      iss.push({
        level: 'info',
        text: `Габариты бака — по расчётному объёму (прямоугольный, стенка ${Mm.text(StationMatrix.tank().wall)} мм; требует подтверждения изготовителем бака): ${list}. Свои размеры — строкой «Габариты» в составе станции.`,
      });
    }
    const guessed = equip.filter(unit => unit.place && !unit.known && unit.kind !== 'tank');
    if (guessed.length) {
      const list = guessed
        .map(unit => `${LayoutNotes._named(unit)} ${Mm.text(unit.l)} × ${Mm.text(unit.w)} × ${Mm.text(unit.h)} мм`)
        .join('; ');
      iss.push({
        level: 'info',
        text: `Габариты не указаны в характеристиках — взяты условные: ${list}. Укажите размеры в составе станции (характеристики элемента).`,
      });
    }
    const missing = equip.filter(unit => unit.nodims);
    if (missing.length)
      iss.push({
        level: 'info',
        text: `Не размещены — нет габаритов: ${missing.map(unit => `«${unit.name}»`).join(', ')}.`,
      });
  }

  /** Ресиверы снаружи: площадка и подключение; при морозе — конденсат, если воздух не осушен адсорбционным осушителем. */
  outside(plan, iss) {
    const out = plan.outside || [];
    if (!out.length) return;
    const dryers = this.lay.equip.filter(unit => unit.kind === 'dryer' && unit.air && unit.air.type !== 'gen');
    iss.push({
      level: 'info',
      text: `${out.length > 1 ? 'Ресиверы' : 'Ресивер'} поз. ${Num.uniq(out.map(i => i.pos)).join(', ')} — снаружи, на бетонной площадке в ${Mm.text(StationMatrix.recv().outGap)} мм от дальнего торца (ФНП ОРПД, п. 65): трубопровод — через стену с запорной арматурой, на ресивере — предохранительный клапан и манометр, площадка — с ограждением от наезда.`,
    });
    if (!dryers.length) {
      iss.push({
        level: 'warn',
        text: 'Ресивер снаружи без осушителя: зимой конденсат в ресивере и отводе замерзает — нужен обогреваемый отвод конденсата (греющий кабель, теплоизоляция) или осушитель перед ресивером.',
      });
    } else if (!dryers.some(unit => unit.air.type === 'ads')) {
      iss.push({
        level: 'info',
        text: `Ресивер снаружи после рефрижераторного осушителя (точка росы ${AirChain.refrigDew()}): при морозе в нём выпадает и замерзает конденсат — нужен обогреваемый отвод конденсата или адсорбционный осушитель (точка росы −40 °C).`,
      });
    }
    if (plan.chassis)
      iss.push({
        level: 'info',
        text: 'Станция на шасси: ресивер снаружи перевозится отдельно и ставится на площадку на объекте.',
      });
  }

  _fuelEntry(plan) {
    const gate = plan.fuel.gate;
    if (gate) return `двустворчатые ворота в торце ${Mm.text(gate.w)} × ${Mm.text(gate.h)} мм (монтаж и замена бака)`;
    return plan.geo && plan.geo.sea ? 'штатные двери контейнера' : 'своя дверь снаружи';
  }

  /** Замечания о топливном отсеке. */
  fuel(plan, iss) {
    if (!plan.fuel) return;
    const tankPos = Num.uniq((plan.items || []).filter(i => i.tank).map(i => i.pos)).join(', ');
    iss.push({
      level: 'info',
      text: `Топливный бак поз. ${tankPos} — в отдельном отсеке у торца: противопожарная перегородка 1-го типа (${StationNorms.FIRE_WALL}) без проёмов, топливопровод — через гильзу с уплотнением; вход в отсек — ${this._fuelEntry(plan)}; заливная горловина — ${LayoutNotes.FILL_WALL[plan.fuel.fill.wall]}, утоплена в стену: ниша с лючком заподлицо под замок (ничего не выступает, габарит не меняется); дыхательный клапан с огнепреградителем — над крышей; бак — в поддоне на полный объём; в отсеке — естественная вентиляция.`,
    });
  }

  /** Учёт в Ростехнадзоре — по произведению давления на вместимость. */
  vessels(plan, iss) {
    const vessels = (plan.vessels || []).filter(v => v.pv != null);
    const reg = vessels.filter(v => v.reg);
    const free = vessels.filter(v => !v.reg);
    const list = part => part.map(v => `поз. ${v.pos} — ${PressureVessel.text(v)}`).join('; ');
    if (reg.length) {
      const inside = reg.some(v => !v.out)
        ? '; размещают на открытой площадке или в отдельном здании, в помещении — когда иначе нельзя (п. 65): «Ресивер снаружи» — в требованиях заказчика на вкладке «Состав станции»'
        : '';
      iss.push({
        level: 'info',
        text: `Подлежат учёту в Ростехнадзоре (ФНП ОРПД, п. 223: p·V больше ${PressureVessel.limitText()} МПа·м³): ${list(reg)}. Регистрация, техническое освидетельствование и ответственные за исправное состояние — у эксплуатирующей организации${inside}.`,
      });
    }
    if (free.length)
      iss.push({
        level: 'info',
        text: `Учёту в Ростехнадзоре не подлежат (p·V не больше ${PressureVessel.limitText()} МПа·м³): ${list(free)}.${LayoutNotes._ratedNote(free)}`,
      });
  }

  // сосуды с паспортным давлением выше рабочего: без учёта — при уставке клапана не выше рабочего
  static _ratedNote(free) {
    const rated = free.filter(v => v.rated);
    if (!rated.length) return '';
    const pos = Num.uniq(rated.map(v => v.pos)).join(', ');
    const bar = Mm.dec(Math.round(rated[0].mpa * 100) / 10);
    return ` Поз. ${pos}: паспортное давление выше рабочего — без учёта при уставке предохранительного клапана не выше ${bar} бар (учёт — по рабочему давлению, ФНП ОРПД, п. 223 а; по паспортному давлению p·V больше ${PressureVessel.limitText()}).`;
  }

  /** Глушитель на крыше: высота станции с ним, по одному на ДГУ, условный размер. */
  roof(plan, iss) {
    const roof = plan.roof || [];
    if (!roof.length || !plan.geo || !plan.geo.ext) return;
    const top = Math.max(...roof.map(item => item.gap + item.d));
    const height = plan.geo.ext[2] + Math.max(top, plan.geo.rise || 0);
    const chassis = plan.chassis ? LayoutRoof.CHASSIS_H : 0;
    iss.push({
      level: 'info',
      text: `Глушитель на крыше над ДГУ, выхлоп — горизонтально в сторону (не вверх): высота станции с глушителем ${Mm.text(height)} мм${chassis ? ` (на шасси — ${Mm.text(height + chassis)} мм)` : ''}. Глушитель съёмный: при перевозке его снимают и ставят на объекте — высота с платформой не более ${Mm.text(LayoutRoof.ROAD_H)} мм.`,
    });
    const qty = this.lay.equip
      .filter(unit => unit.kind === 'muffler' && unit.roof)
      .reduce((total, unit) => total + unit.qty, 0);
    if (roof.length > qty) {
      iss.push({
        level: 'warn',
        text: `Глушитель на крыше — у каждой ДГУ (если хоть у одной он на крыше): в составе ${qty} шт., нужно ${roof.length} — увеличьте количество «${roof[0].name}» до ${roof.length}.`,
      });
    }
    const guessed = roof.filter(item => !item.known);
    if (guessed.length) {
      const list = Num.uniq(
        guessed.map(item => `поз. ${item.pos} — ${Mm.text(Math.max(item.lx, item.ly))} × Ø${Mm.text(item.d)} мм`),
      ).join('; ');
      iss.push({ level: 'info', text: `Размер глушителя не указан — взят условный по мощности ДГУ: ${list}.` });
    }
  }

  _exhaustWho(wall, all) {
    if (wall.length === all) return all > 1 ? 'всех ДГУ' : 'ДГУ';
    return wall.length > 1 ? `${wall.length} ДГУ` : 'одной ДГУ';
  }

  /** Выхлоп каждой ДГУ без своего глушителя на крыше — через стену (глушитель встроен в ДГУ). */
  exhausts(plan, iss) {
    const all = plan.exhausts || [];
    const wall = all.filter(unit => unit.how === 'wall');
    if (!wall.length) return;
    const heights = Num.uniq(wall.map(unit => Mm.text(unit.z))).join(' / ');
    iss.push({
      level: 'info',
      text: `Выхлоп ${this._exhaustWho(wall, all.length)} — через заднюю стену (у каждой — свой вывод, над ДГУ на высоте ${heights} мм): глушителя на крыше для ${wall.length > 1 ? 'них' : 'неё'} в составе нет — глушитель встроен в ДГУ (у небольших ДГУ — штатно). Проходка — через гильзу с негорючей теплоизоляцией, снаружи — отвод вниз под 45° с дождевым колпаком; не напротив приточных жалюзи и дверей. Если встроенного глушителя нет — добавьте в состав «Глушитель на крыше» (по одному на ДГУ).`,
    });
  }

  /** Трубопровод: в составе нет, а фильтры на трубе; материал не выбран; полипропилен — не для топлива и горячего воздуха. */
  piping(plan, iss) {
    const equip = this.lay.equip;
    const hang = (plan.items || []).filter(i => i.mount === 'pipe' && !i.unit);
    for (const pipe of plan.piping || []) {
      if (pipe.implicit) {
        iss.push({
          level: 'info',
          text: `Фильтры (${hang.map(i => `поз. ${i.pos}`).join(', ')}) висят на трубопроводе, а трубопроводной обвязки в составе нет — добавьте элемент «Трубопроводная обвязка и запорная арматура».`,
        });
      } else if (!pipe.mat) {
        iss.push({
          level: 'info',
          text: `Материал трубопровода (поз. ${pipe.pos}) не выбран — на чертеже сталь. Выберите в «Составе станции»: сталь, нержавеющая сталь или полипропилен.`,
        });
      } else if (pipe.mat === 'pp' && equip.some(unit => unit.kind === 'dgu')) {
        iss.push({
          level: 'warn',
          text: `Топливопровод (поз. ${pipe.pos}) из полипропилена не применяют — выберите сталь или нержавеющую сталь.`,
        });
      } else if (pipe.mat === 'pp' && equip.some(unit => unit.kind === 'compressor')) {
        iss.push({
          level: 'info',
          text: `Полипропилен для сжатого воздуха (поз. ${pipe.pos}) — только в пределах давления труб при рабочей температуре (PP-R PN20 — 20 бар при 20 °C, при нагреве меньше); участок сразу после компрессора — металлом.`,
        });
      }
    }
  }
}
